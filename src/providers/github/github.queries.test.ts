import { describe, expect, it } from 'bun:test'

import type { FetchLike } from '../../types/standup.types'
import { GitHubProvider } from './github'

function routedFetch(routes: Record<string, unknown>): FetchLike {
    return async (url: string) => {
        for (const [needle, payload] of Object.entries(routes)) {
            if (url.includes(needle)) {
                return new Response(JSON.stringify(payload), { status: 200 })
            }
        }
        return new Response('[]', { status: 200 })
    }
}

describe('getEvents', () => {
    it('reads the feed for the authenticated login and sorts ascending', async () => {
        const gh = new GitHubProvider(
            'github.com',
            't',
            routedFetch({
                '/users/dev/events': [
                    {
                        type: 'PullRequestEvent',
                        created_at: '2026-08-27T11:00:00Z',
                        repo: { name: 'acme/api' },
                        payload: { action: 'opened', pull_request: { title: 'feat: stories' } },
                    },
                    {
                        type: 'PushEvent',
                        created_at: '2026-08-27T09:00:00Z',
                        repo: { name: 'acme/web' },
                        payload: { ref: 'refs/heads/main', size: 3, commits: [{ message: 'fix: a' }] },
                    },
                ],
                '/user': { id: 1, login: 'dev' },
            })
        )

        const rows = await gh.getEvents(new Date(2026, 7, 21))
        expect(rows).toHaveLength(2)
        expect(rows[0]!.action).toBe('pushed to')
        expect(rows[1]!.action).toBe('opened')
    })

    it('drops events older than the lookback window', async () => {
        const gh = new GitHubProvider(
            'github.com',
            't',
            routedFetch({
                '/users/dev/events': [
                    {
                        type: 'PushEvent',
                        created_at: '2026-06-01T09:00:00Z',
                        repo: { name: 'acme/web' },
                        payload: { ref: 'refs/heads/main', size: 1 },
                    },
                ],
                '/user': { id: 1, login: 'dev' },
            })
        )

        await expect(gh.getEvents(new Date(2026, 7, 21))).resolves.toEqual([])
    })

    it('warns on an empty feed instead of implying a quiet day', async () => {
        const written: string[] = []
        const original = process.stderr.write
        process.stderr.write = ((chunk: unknown) => {
            written.push(String(chunk))
            return true
        }) as typeof process.stderr.write

        try {
            const gh = new GitHubProvider(
                'github.com',
                't',
                routedFetch({ '/users/dev/events': [], '/user': { id: 1, login: 'dev' } })
            )
            await gh.getEvents(new Date(2026, 7, 21))
        } finally {
            process.stderr.write = original
        }

        expect(written.join('')).toMatch(/events feed/i)
    })
})

const TODAY = new Date(2026, 7, 28)

describe('getMyMrs', () => {
    it('shapes a pull request into the contract', async () => {
        const gh = new GitHubProvider(
            'github.com',
            't',
            routedFetch({
                '/user': { id: 1, login: 'dev' },
                'search/issues': {
                    total_count: 1,
                    items: [
                        {
                            number: 11,
                            title: 'feat: add stories endpoint',
                            html_url: 'https://github.com/acme/api/pull/11',
                            updated_at: '2026-08-27T09:00:00Z',
                            repository_url: 'https://api.github.com/repos/acme/api',
                        },
                    ],
                },
                '/repos/acme/api/pulls/11/reviews': [
                    { state: 'CHANGES_REQUESTED', user: { login: 'teammate' } },
                ],
                '/repos/acme/api/pulls/11': {
                    number: 11,
                    title: 'feat: add stories endpoint',
                    draft: false,
                    html_url: 'https://github.com/acme/api/pull/11',
                    updated_at: '2026-08-27T09:00:00Z',
                    mergeable_state: 'blocked',
                    head: { ref: 'feat/stories', sha: 'abc123' },
                    base: { ref: 'main', repo: { id: 909 } },
                },
                '/commits/abc123/check-runs': {
                    total_count: 1,
                    check_runs: [
                        { id: 7, name: 'build', status: 'completed', conclusion: 'success' },
                    ],
                },
            })
        )

        const [row] = await gh.getMyMrs(TODAY)
        expect(row).toMatchObject({
            provider: 'github',
            project: 'acme/api',
            projectId: 909,
            iid: 11,
            branch: 'feat/stories',
            target: 'main',
            mergeStatus: 'blocked',
            pipeline: 'success',
            unresolved: 1,
            bucket: 'blocked',
        })
    })

    it('searches for open pull requests authored by the login', async () => {
        const urls: string[] = []
        const fetchImpl: FetchLike = async (url: string) => {
            urls.push(url)
            if (url.includes('/user')) {
                return new Response(JSON.stringify({ id: 1, login: 'dev' }), { status: 200 })
            }
            return new Response(JSON.stringify({ items: [] }), { status: 200 })
        }
        const gh = new GitHubProvider('github.com', 't', fetchImpl)

        await gh.getMyMrs(TODAY)
        const search = urls.find((url) => url.includes('search/issues'))!
        expect(decodeURIComponent(search).replace(/\+/g, ' ')).toContain(
            'is:pr is:open author:dev archived:false'
        )
    })

    it('marks a pull request with no checks as missing a pipeline when its repo has some', async () => {
        const gh = new GitHubProvider(
            'github.com',
            't',
            routedFetch({
                '/user': { id: 1, login: 'dev' },
                'search/issues': {
                    items: [
                        {
                            number: 1,
                            title: 'with ci',
                            html_url: 'u1',
                            updated_at: '2026-08-27T09:00:00Z',
                            repository_url: 'https://api.github.com/repos/acme/web',
                        },
                        {
                            number: 2,
                            title: 'without ci',
                            html_url: 'u2',
                            updated_at: '2026-08-27T09:00:00Z',
                            repository_url: 'https://api.github.com/repos/acme/web',
                        },
                    ],
                },
                '/repos/acme/web/pulls/1/reviews': [],
                '/repos/acme/web/pulls/2/reviews': [],
                '/repos/acme/web/pulls/1': {
                    number: 1,
                    title: 'with ci',
                    draft: false,
                    html_url: 'u1',
                    updated_at: '2026-08-27T09:00:00Z',
                    head: { ref: 'a', sha: 'sha1' },
                    base: { ref: 'main', repo: { id: 1 } },
                },
                '/repos/acme/web/pulls/2': {
                    number: 2,
                    title: 'without ci',
                    draft: false,
                    html_url: 'u2',
                    updated_at: '2026-08-27T09:00:00Z',
                    head: { ref: 'b', sha: 'sha2' },
                    base: { ref: 'main', repo: { id: 1 } },
                },
                '/commits/sha1/check-runs': {
                    check_runs: [
                        { id: 1, name: 'build', status: 'completed', conclusion: 'success' },
                    ],
                },
                '/commits/sha2/check-runs': { check_runs: [] },
            })
        )

        const rows = await gh.getMyMrs(TODAY)
        expect(rows.find((row) => row.iid === 1)!.pipelineMissing).toBe(false)
        expect(rows.find((row) => row.iid === 2)!.pipelineMissing).toBe(true)
    })
})
