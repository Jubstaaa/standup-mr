import pMap from 'p-map'

import { classify, markMissingPipelines } from '../../buckets/buckets'
import { isoDay, localDay } from '../../dates/dates'
import { MS_PER_DAY } from '../../dates/dates.constants'
import type {
    ActivityEvent,
    Blocker,
    FetchLike,
    Identity,
    MergeRequest,
    Review,
} from '../../standup.types'
import { extractErrors } from '../../trace/trace'
import type { Provider } from '../base/base.types'
import { degradable, undiagnosed } from '../base/diagnosis'
import {
    ApiError,
    assertUsable,
    buildUrl,
    JSON_BYTES_CAP,
    readJsonCapped,
    readTail,
    REQUEST_CONCURRENCY,
    sendWithRetry,
    timedFetch,
    unreachable,
} from '../base/http'

import {
    API_VERSION,
    DOT_COM,
    EVENTS_PAGE_CAP,
    FAILED_CONCLUSIONS,
    FRESH_REVIEW_DAYS,
    PAGE_SIZE,
    SEARCH_CAP,
} from './github.constants'
import { mapEvent, repoFromUrl } from './github.map'
import {
    approvedBy,
    countChangesRequested,
    normalizeChecks,
} from './github.state'
import type {
    CheckRun,
    PullDetail,
    PullReview,
    RawEvent,
    SearchItem,
    WorkflowJob,
    WorkflowRun,
} from './github.types'

type Params = Record<string, string | number>

export class GitHubProvider implements Provider {
    readonly kind = 'github' as const
    readonly host: string
    readonly api: string
    private readonly token: string
    private readonly fetchImpl: FetchLike
    private identity: Identity | null = null
    private readonly warningList: string[] = []

    constructor(
        host: string,
        token: string,
        fetchImpl: FetchLike = timedFetch()
    ) {
        this.host = host
        this.api =
            host === DOT_COM
                ? 'https://api.github.com'
                : `https://${host}/api/v3`
        this.token = token
        this.fetchImpl = fetchImpl
    }

    private headers(): Record<string, string> {
        return {
            'authorization': `Bearer ${this.token}`,
            'accept': 'application/vnd.github+json',
            'x-github-api-version': API_VERSION,
        }
    }

    private async send(url: string, init?: RequestInit): Promise<Response> {
        return await sendWithRetry(
            this.fetchImpl,
            url,
            { headers: this.headers(), ...init },
            this.host
        )
    }

    async getJson<T>(path: string, params?: Params): Promise<T | null> {
        const response = await this.send(buildUrl(this.api, path, params))
        assertUsable(response, this.host)
        if (!response.ok) return null
        let body: unknown
        try {
            body = await readJsonCapped(
                response,
                JSON_BYTES_CAP,
                this.host,
                path
            )
        } catch (cause) {
            if (cause instanceof ApiError) throw cause
            throw unreachable(this.host, cause)
        }
        return body as T
    }

    async getPaged<T>(
        path: string,
        params: Params = {},
        cap = 5
    ): Promise<T[]> {
        const rows: T[] = []
        for (let page = 1; page <= cap; page += 1) {
            const chunk = await this.getJson<T[]>(path, {
                ...params,
                per_page: PAGE_SIZE,
                page,
            })
            if (!chunk || chunk.length === 0) break
            rows.push(...chunk)
            if (chunk.length < PAGE_SIZE) break
        }
        return rows
    }

    async getSearch<T>(query: string, cap = 3): Promise<T[]> {
        const rows: T[] = []
        for (let page = 1; page <= cap; page += 1) {
            const chunk = await this.getJson<{ items?: T[] }>('search/issues', {
                q: query,
                per_page: PAGE_SIZE,
                page,
            })
            const items = chunk?.items ?? []
            if (items.length === 0) break
            rows.push(...items)
            if (items.length < PAGE_SIZE) break
        }
        return rows
    }

    async getLogText(path: string): Promise<string> {
        const first = await this.send(buildUrl(this.api, path), {
            redirect: 'manual',
        })
        if (first.status === 404) return ''

        const location = first.headers.get('location')
        if (!location) {
            if (
                first.status === 0 ||
                (first.status >= 300 && first.status < 400)
            )
                return ''
            assertUsable(first, this.host)
            return first.ok ? await readTail(first) : ''
        }

        let blob: Response
        try {
            blob = await this.fetchImpl(location)
        } catch (cause) {
            throw unreachable(this.host, cause)
        }
        if (!blob.ok) {
            throw new ApiError(
                `job log unavailable: HTTP ${blob.status}`,
                blob.status
            )
        }
        return await readTail(blob)
    }

    warnings(): string[] {
        return [...this.warningList]
    }

    async getIdentity(): Promise<Identity> {
        if (this.identity) return this.identity

        const me = await this.getJson<{ id: number; login: string }>('user')
        if (!me) {
            throw new ApiError(
                `Could not read the ${this.host} user. Check the host, the token, and network access.`
            )
        }
        this.identity = { id: me.id, username: me.login }
        return this.identity
    }

    async getEvents(since: Date): Promise<ActivityEvent[]> {
        const login = (await this.getIdentity()).username
        const raw = await this.getPaged<RawEvent>(
            `users/${encodeURIComponent(login)}/events`,
            {},
            EVENTS_PAGE_CAP
        )

        if (raw.length === 0) {
            this.warningList.push(
                `the ${this.host} events feed returned nothing. Private activity ` +
                    'is only visible to a token that belongs to the same account.'
            )
        }

        const floor = isoDay(since)
        return raw
            .map(mapEvent)
            .filter(event => event.at.slice(0, 10) >= floor)
            .sort((a, b) => a.at.localeCompare(b.at))
    }

    private async shapePr(item: SearchItem): Promise<MergeRequest | null> {
        const project = repoFromUrl(item.repository_url)
        const iid = item.number

        const pull = await this.getJson<PullDetail>(
            `repos/${project}/pulls/${iid}`
        )
        if (!pull) return null

        const sha = pull.head?.sha ?? ''

        const [checks, reviews] = await Promise.all([
            sha
                ? this.getJson<{ check_runs?: CheckRun[] }>(
                      `repos/${project}/commits/${sha}/check-runs`,
                      { per_page: PAGE_SIZE }
                  )
                : Promise.resolve(null),
            this.getPaged<PullReview>(
                `repos/${project}/pulls/${iid}/reviews`,
                {},
                2
            ),
        ])

        const { pipeline, pipelineId } = normalizeChecks(
            checks?.check_runs ?? []
        )

        return {
            provider: 'github',
            project,
            projectId: pull.base?.repo?.id ?? 0,
            iid,
            title: pull.title,
            draft: pull.draft,
            branch: pull.head?.ref ?? '',
            target: pull.base?.ref ?? '',
            updated: localDay(pull.updated_at),
            url: pull.html_url,
            mergeStatus: pull.mergeable_state ?? null,
            pipeline,
            pipelineId,
            unresolved: countChangesRequested(reviews),
            pipelineMissing: false,
            bucket: 'ready',
        }
    }

    async getMyMrs(today: Date): Promise<MergeRequest[]> {
        const login = (await this.getIdentity()).username
        const items = await this.getSearch<SearchItem>(
            `is:pr is:open author:${login} archived:false`,
            SEARCH_CAP
        )
        const shaped = await pMap(items, item => this.shapePr(item), {
            concurrency: REQUEST_CONCURRENCY,
        })
        const rows = shaped.filter((row): row is MergeRequest => row !== null)

        markMissingPipelines(rows)
        for (const row of rows) {
            row.bucket = classify(row, today)
        }
        return rows
    }

    async getReviews(identity: Identity, today: Date): Promise<Review[]> {
        const items = await this.getSearch<SearchItem>(
            `is:pr is:open review-requested:${identity.username}`,
            SEARCH_CAP
        )
        const cutoff = isoDay(
            new Date(today.getTime() - FRESH_REVIEW_DAYS * MS_PER_DAY)
        )

        const rows = await pMap(
            items,
            async item => {
                const project = repoFromUrl(item.repository_url)
                const reviews = await this.getPaged<PullReview>(
                    `repos/${project}/pulls/${item.number}/reviews`,
                    {},
                    2
                )
                const updated = localDay(item.updated_at)

                return {
                    provider: 'github' as const,
                    project,
                    iid: item.number,
                    title: item.title,
                    author: item.user?.login ?? '',
                    updated,
                    draft: item.draft ?? false,
                    url: item.html_url,
                    fresh: updated >= cutoff,
                    approvedByMe: approvedBy(reviews, identity.username),
                }
            },
            { concurrency: REQUEST_CONCURRENCY }
        )

        return rows.sort((a, b) => b.updated.localeCompare(a.updated))
    }

    private async actionsBlocker(
        mr: MergeRequest,
        sha: string
    ): Promise<Blocker | null> {
        const runs = await this.getJson<{ workflow_runs?: WorkflowRun[] }>(
            `repos/${mr.project}/actions/runs`,
            { head_sha: sha, per_page: 10 }
        )
        const run = (runs?.workflow_runs ?? []).find(
            row =>
                row.conclusion !== null &&
                FAILED_CONCLUSIONS.has(row.conclusion)
        )
        if (!run) return null

        const jobs = await this.getJson<{ jobs?: WorkflowJob[] }>(
            `repos/${mr.project}/actions/runs/${run.id}/jobs`,
            { filter: 'latest', per_page: PAGE_SIZE }
        )
        const job = (jobs?.jobs ?? []).find(
            row =>
                row.conclusion !== null &&
                FAILED_CONCLUSIONS.has(row.conclusion)
        )
        if (!job) return null

        let errors: string[]
        try {
            errors = extractErrors(
                await this.getLogText(
                    `repos/${mr.project}/actions/jobs/${job.id}/logs`
                )
            )
        } catch (cause) {
            if (!degradable(cause)) throw cause
            errors = [cause.message]
        }
        return {
            provider: 'github',
            project: mr.project,
            mr: mr.iid,
            title: mr.title,
            job: job.name,
            stage: run.name ?? '',
            url: mr.url,
            errors,
        }
    }

    private async checkRunBlocker(
        mr: MergeRequest,
        sha: string
    ): Promise<Blocker | null> {
        const checks = await this.getJson<{ check_runs?: CheckRun[] }>(
            `repos/${mr.project}/commits/${sha}/check-runs`,
            { per_page: PAGE_SIZE }
        )
        const failed = (checks?.check_runs ?? []).find(
            run =>
                run.conclusion !== null &&
                FAILED_CONCLUSIONS.has(run.conclusion)
        )
        if (!failed) return null

        const summary = [
            failed.output?.summary ?? '',
            failed.output?.text ?? '',
        ]
            .filter(Boolean)
            .join('\n')
        const errors = extractErrors(summary)
        if (errors.length === 0) return null

        return {
            provider: 'github',
            project: mr.project,
            mr: mr.iid,
            title: mr.title,
            job: failed.name,
            stage: failed.app?.slug ?? 'check',
            url: mr.url,
            errors,
        }
    }

    private async diagnose(mr: MergeRequest): Promise<Blocker | null> {
        const pull = await this.getJson<PullDetail>(
            `repos/${mr.project}/pulls/${mr.iid}`
        )
        const sha = pull?.head?.sha
        if (!sha) {
            throw new ApiError(
                `the head commit of #${mr.iid} could not be read`
            )
        }

        const actions = await this.actionsBlocker(mr, sha)
        if (actions?.errors.length) return actions
        const blocker = (await this.checkRunBlocker(mr, sha)) ?? actions
        if (!blocker) {
            throw new ApiError(`no failed job found for commit ${sha}`)
        }
        return blocker
    }

    async getBlockers(mrs: MergeRequest[]): Promise<Blocker[]> {
        const red = mrs.filter(mr => mr.pipeline === 'failed')
        const diagnosed = await pMap(red, mr => this.tryDiagnose(mr), {
            concurrency: REQUEST_CONCURRENCY,
        })
        return diagnosed.filter((row): row is Blocker => row !== null)
    }

    private async tryDiagnose(mr: MergeRequest): Promise<Blocker | null> {
        try {
            return await this.diagnose(mr)
        } catch (cause) {
            if (degradable(cause)) return undiagnosed(mr, cause)
            throw cause
        }
    }
}
