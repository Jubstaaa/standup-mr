/** GitLab provider: HTTP plumbing plus the queries the standup needs. */

import type {
    ActivityEvent,
    Blocker,
    FetchLike,
    Identity,
    MergeRequest,
    Review,
} from '../types'
import type { Provider } from './base'

export const PAGE_SIZE = 100

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

    // -- transport ---------------------------------------------------

    private url(path: string, params?: Params): string {
        const base = `${this.api}/${path}`
        if (!params || Object.keys(params).length === 0) return base
        const query = new URLSearchParams()
        for (const [key, value] of Object.entries(params)) {
            query.set(key, String(value))
        }
        return `${base}?${query.toString()}`
    }

    /** Parsed JSON for one request, or null if anything goes wrong. */
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

    /** Raw body for one request, or '' if anything goes wrong. */
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

    /** Follow pagination up to `cap` pages, stopping on a short page. */
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

    // -- queries (filled in by later tasks) --------------------------

    getIdentity(): Promise<Identity> {
        throw new Error('Not implemented')
    }

    getEvents(_since: Date): Promise<ActivityEvent[]> {
        throw new Error('Not implemented')
    }

    getMyMrs(_today: Date): Promise<MergeRequest[]> {
        throw new Error('Not implemented')
    }

    getReviews(_uid: number, _today: Date): Promise<Review[]> {
        throw new Error('Not implemented')
    }

    getBlockers(_mrs: MergeRequest[]): Promise<Blocker[]> {
        throw new Error('Not implemented')
    }
}
