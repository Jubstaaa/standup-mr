import { ApiError, assertUsable, unreachable } from '../base/http'
import { API_VERSION, DOT_COM, PAGE_SIZE } from './github.constants'
import type { Identity, FetchLike } from '../../types/standup.types'

type Params = Record<string, string | number>

export class GitHubProvider {
    readonly kind = 'github' as const
    readonly host: string
    readonly api: string
    private readonly token: string
    private readonly fetchImpl: FetchLike
    private identity: Identity | null = null

    constructor(host: string, token: string, fetchImpl: FetchLike = fetch) {
        this.host = host
        this.api = host === DOT_COM ? 'https://api.github.com' : `https://${host}/api/v3`
        this.token = token
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

    private headers(): Record<string, string> {
        return {
            authorization: `Bearer ${this.token}`,
            accept: 'application/vnd.github+json',
            'x-github-api-version': API_VERSION,
        }
    }

    private async send(url: string, init?: RequestInit): Promise<Response> {
        try {
            return await this.fetchImpl(url, { headers: this.headers(), ...init })
        } catch (cause) {
            throw unreachable(this.host, cause)
        }
    }

    async getJson<T>(path: string, params?: Params): Promise<T | null> {
        const response = await this.send(this.url(path, params))
        assertUsable(response, this.host)
        if (!response.ok) return null
        try {
            return (await response.json()) as T
        } catch (cause) {
            throw unreachable(this.host, cause)
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
        const first = await this.send(this.url(path), { redirect: 'manual' })
        if (first.status === 404) return ''

        const location = first.headers.get('location')
        if (!location) {
            assertUsable(first, this.host)
            return first.ok ? await first.text() : ''
        }

        let blob: Response
        try {
            blob = await this.fetchImpl(location)
        } catch (cause) {
            throw unreachable(this.host, cause)
        }
        if (!blob.ok) return ''
        return await blob.text()
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
}
