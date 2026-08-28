import { classify, markMissingPipelines } from '../../buckets/buckets'
import { isoDay } from '../../dates/dates'
import { MS_PER_DAY } from '../../dates/dates.constants'
import type {
    ActivityEvent,
    Blocker,
    FetchLike,
    Identity,
    MergeRequest,
    Review,
} from '../../types/standup.types'
import { extractErrors } from '../../trace/trace'
import type { Provider } from '../base/base.types'
import { FRESH_REVIEW_DAYS, PAGE_SIZE } from './gitlab.constants'

type Params = Record<string, string | number>

export class GitLabProvider implements Provider {
    readonly host: string
    readonly api: string
    private readonly token: string
    private readonly fetchImpl: FetchLike

    constructor(host: string, token: string, fetchImpl: FetchLike = fetch) {
        this.host = host
        this.token = token
        this.api = `https://${host}/api/v4`
        this.fetchImpl = fetchImpl
    }

    private url(path: string, params?: Params): string {
        const base = `${this.api}/${path}`
        if (!params || Object.keys(params).length === 0) return base
        const query = new URLSearchParams()
        for (const [key, value] of Object.entries(params)) {
            query.set(key, String(value))
        }
        return `${base}?${query.toString()}`
    }

    async getJson<T>(path: string, params?: Params): Promise<T | null> {
        try {
            const response = await this.fetchImpl(this.url(path, params), {
                headers: { 'PRIVATE-TOKEN': this.token },
            })
            if (!response.ok) return null
            return (await response.json()) as T
        } catch {
            return null
        }
    }

    async getText(path: string): Promise<string> {
        try {
            const response = await this.fetchImpl(this.url(path), {
                headers: { 'PRIVATE-TOKEN': this.token },
            })
            if (!response.ok) return ''
            return await response.text()
        } catch {
            return ''
        }
    }

    async getPaged<T>(path: string, params: Params = {}, cap = 5): Promise<T[]> {
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

    async getIdentity(): Promise<Identity> {
        const me = await this.getJson<{ id: number; username: string }>('user')
        if (!me) {
            throw new Error(
                `Could not reach ${this.host}. Check the host, the token, and network access.`
            )
        }
        return { id: me.id, username: me.username }
    }

    async projectPath(projectId: number): Promise<string> {
        const project = await this.getJson<{ path_with_namespace?: string }>(
            `projects/${projectId}`
        )
        return project?.path_with_namespace ?? String(projectId)
    }

    async getEvents(since: Date): Promise<ActivityEvent[]> {
        const raw = await this.getPaged<Record<string, any>>('events', {
            after: isoDay(since),
        })

        const ids = [...new Set(raw.map((e) => e.project_id).filter(Boolean))] as number[]
        const paths = new Map(
            await Promise.all(
                ids.map(async (id) => [id, await this.projectPath(id)] as const)
            )
        )

        return raw
            .map((event) => {
                const push = event.push_data ?? {}
                return {
                    at: String(event.created_at).slice(0, 16),
                    action: event.action_name,
                    project: paths.get(event.project_id) ?? '',
                    targetType: event.target_type ?? '',
                    title: event.target_title ?? '',
                    branch: push.ref ?? '',
                    commits: push.commit_count ?? 0,
                    commitTitle: push.commit_title ?? '',
                }
            })
            .sort((a, b) => a.at.localeCompare(b.at))
    }

    private async countUnresolved(projectId: number, iid: number): Promise<number> {
        const discussions = await this.getJson<Array<{ notes?: Array<Record<string, any>> }>>(
            `projects/${projectId}/merge_requests/${iid}/discussions`,
            { per_page: PAGE_SIZE }
        )
        if (!discussions) return 0

        return discussions.filter((discussion) => {
            const notes = (discussion.notes ?? []).filter((n) => !n.system)
            return notes.length > 0 && notes.some((n) => n.resolvable && !n.resolved)
        }).length
    }

    private async shapeMr(mr: Record<string, any>): Promise<MergeRequest> {
        const projectId: number = mr.project_id
        const iid: number = mr.iid

        const [pipelines, unresolved] = await Promise.all([
            this.getJson<Array<{ id: number; status: string }>>(
                `projects/${projectId}/merge_requests/${iid}/pipelines`,
                { per_page: 1 }
            ),
            this.countUnresolved(projectId, iid),
        ])
        const latest = pipelines?.[0]

        return {
            project: String(mr.references.full).split('!')[0]!,
            projectId,
            iid,
            title: mr.title,
            draft: mr.draft,
            branch: mr.source_branch,
            target: mr.target_branch,
            updated: String(mr.updated_at).slice(0, 10),
            url: mr.web_url,
            mergeStatus: mr.detailed_merge_status ?? null,
            pipeline: latest?.status ?? null,
            pipelineId: latest?.id ?? null,
            unresolved,
            pipelineMissing: false,
            bucket: 'ready',
        }
    }

    async getMyMrs(today: Date): Promise<MergeRequest[]> {
        const raw = await this.getPaged<Record<string, any>>('merge_requests', {
            scope: 'created_by_me',
            state: 'opened',
        })
        const rows = await Promise.all(raw.map((mr) => this.shapeMr(mr)))

        markMissingPipelines(rows)
        for (const row of rows) {
            row.bucket = classify(row, today)
        }
        return rows
    }

    private async approvedByMe(
        projectId: number,
        iid: number,
        uid: number
    ): Promise<boolean> {
        const approvals = await this.getJson<{
            approved_by?: Array<{ user?: { id?: number } }>
        }>(`projects/${projectId}/merge_requests/${iid}/approvals`)
        if (!approvals) return false
        return (approvals.approved_by ?? []).some((entry) => entry.user?.id === uid)
    }

    async getReviews(uid: number, today: Date): Promise<Review[]> {
        const raw = await this.getPaged<Record<string, any>>('merge_requests', {
            scope: 'all',
            state: 'opened',
            reviewer_id: uid,
        })
        const cutoff = isoDay(new Date(today.getTime() - FRESH_REVIEW_DAYS * MS_PER_DAY))

        const rows = await Promise.all(
            raw.map(async (mr) => ({
                project: String(mr.references.full).split('!')[0]!,
                iid: mr.iid as number,
                title: mr.title as string,
                author: mr.author.name as string,
                updated: String(mr.updated_at).slice(0, 10),
                draft: mr.draft as boolean,
                url: mr.web_url as string,
                fresh: String(mr.updated_at).slice(0, 10) >= cutoff,
                approvedByMe: await this.approvedByMe(mr.project_id, mr.iid, uid),
            }))
        )

        return rows.sort((a, b) => b.updated.localeCompare(a.updated))
    }

    async getBlockers(mrs: MergeRequest[]): Promise<Blocker[]> {
        const red = mrs.filter((mr) => mr.pipeline === 'failed')

        const diagnosed = await Promise.all(
            red.map(async (mr): Promise<Blocker | null> => {
                const jobs =
                    (await this.getJson<Array<Record<string, any>>>(
                        `projects/${mr.projectId}/pipelines/${mr.pipelineId}/jobs`,
                        { per_page: PAGE_SIZE }
                    )) ?? []
                const job = jobs.find((j) => j.status === 'failed')
                if (!job) return null

                const trace = await this.getText(
                    `projects/${mr.projectId}/jobs/${job.id}/trace`
                )
                return {
                    project: mr.project,
                    mr: mr.iid,
                    title: mr.title,
                    job: job.name,
                    stage: job.stage,
                    url: mr.url,
                    errors: extractErrors(trace),
                }
            })
        )

        return diagnosed.filter((row): row is Blocker => row !== null)
    }
}
