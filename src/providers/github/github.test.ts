import { describe, expect, it, mock } from 'bun:test'

import type { FetchLike } from '../../types/standup.types'
import { GitHubProvider } from './github'

function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
    })
}

function recordingFetch(pages: unknown[]): FetchLike & { calls: string[] } {
    const calls: string[] = []
    const impl = mock(async (url: string, init?: RequestInit) => {
        calls.push(url)
        const headers = new Headers(init?.headers)
        expect(headers.get('authorization')).toBe('Bearer tok')
        expect(headers.get('accept')).toBe('application/vnd.github+json')
        expect(headers.get('x-github-api-version')).toBe('2022-11-28')
        return jsonResponse(pages[Math.min(calls.length - 1, pages.length - 1)])
    })
    return Object.assign(impl as unknown as FetchLike, { calls })
}

describe('GitHubProvider transport', () => {
    it('uses api.github.com for the public host', async () => {
        const fetchImpl = recordingFetch([{ id: 7, login: 'dev' }])
        const gh = new GitHubProvider('github.com', 'tok', fetchImpl)

        await gh.getJson('user')
        expect(fetchImpl.calls[0]).toBe('https://api.github.com/user')
    })

    it('uses the /api/v3 prefix for github enterprise', async () => {
        const fetchImpl = recordingFetch([{ id: 7, login: 'dev' }])
        const gh = new GitHubProvider('git.acme.com', 'tok', fetchImpl)

        await gh.getJson('user')
        expect(fetchImpl.calls[0]).toBe('https://git.acme.com/api/v3/user')
    })

    it('encodes query parameters', async () => {
        const fetchImpl = recordingFetch([[]])
        const gh = new GitHubProvider('github.com', 'tok', fetchImpl)

        await gh.getJson('repos/acme/web/actions/runs', { head_sha: 'abc123', per_page: 10 })
        expect(fetchImpl.calls[0]).toContain('head_sha=abc123')
        expect(fetchImpl.calls[0]).toContain('per_page=10')
    })

    it('returns null on a 404', async () => {
        const missing: FetchLike = async () => new Response('{}', { status: 404 })
        const gh = new GitHubProvider('github.com', 'tok', missing)

        await expect(gh.getJson('repos/acme/web/pulls/9')).resolves.toBeNull()
    })

    it('throws on an invalid token instead of reporting an empty day', async () => {
        const denied: FetchLike = async () => new Response('{}', { status: 401 })
        const gh = new GitHubProvider('github.com', 'tok', denied)

        await expect(gh.getJson('user')).rejects.toThrow(/token/i)
    })

    it('throws when the search rate limit is exhausted', async () => {
        const limited: FetchLike = async () =>
            new Response('{}', { status: 403, headers: { 'x-ratelimit-remaining': '0' } })
        const gh = new GitHubProvider('github.com', 'tok', limited)

        await expect(gh.getJson('search/issues')).rejects.toThrow(/rate limit/i)
    })

    it('stops paging on a short page', async () => {
        const full = Array.from({ length: 100 }, (_, i) => ({ i }))
        const fetchImpl = recordingFetch([full, [{ i: 100 }]])
        const gh = new GitHubProvider('github.com', 'tok', fetchImpl)

        const rows = await gh.getPaged('users/dev/events')
        expect(rows).toHaveLength(101)
        expect(fetchImpl.calls).toHaveLength(2)
    })

    it('unwraps the search envelope', async () => {
        const fetchImpl = recordingFetch([{ total_count: 1, items: [{ number: 4 }] }])
        const gh = new GitHubProvider('github.com', 'tok', fetchImpl)

        const rows = await gh.getSearch<{ number: number }>('is:pr is:open author:dev')
        expect(rows).toEqual([{ number: 4 }])
        expect(fetchImpl.calls[0]).toContain('q=is%3Apr+is%3Aopen+author%3Adev')
    })

    it('follows the log redirect without sending the token', async () => {
        const calls: Array<{
            url: string
            auth: string | null
            redirect: RequestInit['redirect']
        }> = []
        const fetchImpl: FetchLike = async (url, init) => {
            calls.push({
                url,
                auth: new Headers(init?.headers).get('authorization'),
                redirect: init?.redirect,
            })
            if (url.includes('/logs')) {
                return new Response(null, {
                    status: 302,
                    headers: { location: 'https://blob.example.com/log?sig=abc' },
                })
            }
            return new Response('2026-08-28T09:00:00.0000000Z npm ERR! code E404\n', {
                status: 200,
            })
        }
        const gh = new GitHubProvider('github.com', 'tok', fetchImpl)

        const log = await gh.getLogText('repos/acme/web/actions/jobs/9/logs')
        expect(log).toContain('npm ERR!')
        expect(calls[0]!.auth).toBe('Bearer tok')
        expect(calls[0]!.redirect).toBe('manual')
        expect(calls[1]!.url).toBe('https://blob.example.com/log?sig=abc')
        expect(calls[1]!.auth).toBeNull()
        expect(calls[1]!.redirect).toBeUndefined()
    })

    it('returns an empty log when the job has none', async () => {
        const missing: FetchLike = async () => new Response(null, { status: 404 })
        const gh = new GitHubProvider('github.com', 'tok', missing)

        await expect(gh.getLogText('repos/acme/web/actions/jobs/9/logs')).resolves.toBe('')
    })

    it('gives up on an opaque redirect rather than costing the whole note', async () => {
        const opaque: FetchLike = async () => Response.error()
        const gh = new GitHubProvider('github.com', 'tok', opaque)

        await expect(gh.getLogText('repos/acme/web/actions/jobs/9/logs')).resolves.toBe('')
    })
})

describe('getIdentity', () => {
    it('maps login onto username', async () => {
        const gh = new GitHubProvider(
            'github.com',
            'tok',
            recordingFetch([{ id: 285, login: 'dev', name: 'Dev' }])
        )
        await expect(gh.getIdentity()).resolves.toEqual({ id: 285, username: 'dev' })
    })

    it('reads /user only once', async () => {
        const fetchImpl = recordingFetch([{ id: 285, login: 'dev' }])
        const gh = new GitHubProvider('github.com', 'tok', fetchImpl)

        await gh.getIdentity()
        await gh.getIdentity()
        expect(fetchImpl.calls).toHaveLength(1)
    })

    it('throws a descriptive error when the api is unreachable', async () => {
        const gh = new GitHubProvider('git.acme.com', 'tok', async () => {
            throw new Error('offline')
        })
        await expect(gh.getIdentity()).rejects.toThrow(/git\.acme\.com/)
    })
})
