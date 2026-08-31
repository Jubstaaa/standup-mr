import { describe, expect, it } from 'bun:test'

import type { FetchLike } from '../../types/standup.types'
import { routedFetch } from '../base/routes.helpers'
import { GitHubProvider } from './github'

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

    it('stops at the documented event feed cap instead of asking for a page beyond it', async () => {
        const pages: string[] = []
        const full = Array.from({ length: 100 }, () => ({
            type: 'PushEvent',
            created_at: '2026-08-27T09:00:00Z',
            repo: { name: 'acme/web' },
            payload: { ref: 'refs/heads/main', size: 1 },
        }))
        const fetchImpl: FetchLike = async (url: string) => {
            if (new URL(url).pathname === '/user') {
                return new Response(JSON.stringify({ id: 1, login: 'dev' }), { status: 200 })
            }
            pages.push(url)
            return new Response(JSON.stringify(full), { status: 200 })
        }
        const gh = new GitHubProvider('github.com', 't', fetchImpl)

        await gh.getEvents(new Date(2026, 7, 21))
        expect(pages).toHaveLength(3)
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

    it('reports a pull request whose only failing check timed out as blocked, not ready', async () => {
        const gh = new GitHubProvider(
            'github.com',
            't',
            routedFetch({
                '/user': { id: 1, login: 'dev' },
                'search/issues': {
                    total_count: 1,
                    items: [
                        {
                            number: 12,
                            title: 'feat: add timeout job',
                            html_url: 'https://github.com/acme/api/pull/12',
                            updated_at: '2026-08-27T09:00:00Z',
                            repository_url: 'https://api.github.com/repos/acme/api',
                        },
                    ],
                },
                '/repos/acme/api/pulls/12/reviews': [],
                '/repos/acme/api/pulls/12': {
                    number: 12,
                    title: 'feat: add timeout job',
                    draft: false,
                    html_url: 'https://github.com/acme/api/pull/12',
                    updated_at: '2026-08-27T09:00:00Z',
                    mergeable_state: 'clean',
                    head: { ref: 'feat/timeout', sha: 'def456' },
                    base: { ref: 'main', repo: { id: 910 } },
                },
                '/commits/def456/check-runs': {
                    total_count: 1,
                    check_runs: [
                        { id: 8, name: 'slow', status: 'completed', conclusion: 'cancelled' },
                    ],
                },
            })
        )

        const [row] = await gh.getMyMrs(TODAY)
        expect(row).toMatchObject({
            pipeline: 'canceled',
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

    it('drops a pull request whose detail fetch 404s, keeping the rest', async () => {
        const fetchImpl: FetchLike = async (url: string) => {
            if (url.includes('/user')) {
                return new Response(JSON.stringify({ id: 1, login: 'dev' }), { status: 200 })
            }
            if (url.includes('search/issues')) {
                return new Response(
                    JSON.stringify({
                        items: [
                            {
                                number: 3,
                                title: 'gone',
                                html_url: 'u3',
                                updated_at: '2026-08-27T09:00:00Z',
                                repository_url: 'https://api.github.com/repos/acme/web',
                            },
                            {
                                number: 4,
                                title: 'still open',
                                html_url: 'u4',
                                updated_at: '2026-08-27T09:00:00Z',
                                repository_url: 'https://api.github.com/repos/acme/web',
                            },
                        ],
                    }),
                    { status: 200 }
                )
            }
            if (url.includes('/repos/acme/web/pulls/3/reviews')) {
                return new Response('[]', { status: 200 })
            }
            if (url.includes('/repos/acme/web/pulls/3')) {
                return new Response(null, { status: 404 })
            }
            if (url.includes('/repos/acme/web/pulls/4/reviews')) {
                return new Response('[]', { status: 200 })
            }
            if (url.includes('/repos/acme/web/pulls/4')) {
                return new Response(
                    JSON.stringify({
                        number: 4,
                        title: 'still open',
                        draft: false,
                        html_url: 'u4',
                        updated_at: '2026-08-27T09:00:00Z',
                        head: { ref: 'b', sha: 'sha4' },
                        base: { ref: 'main', repo: { id: 1 } },
                    }),
                    { status: 200 }
                )
            }
            if (url.includes('/commits/sha4/check-runs')) {
                return new Response(JSON.stringify({ check_runs: [] }), { status: 200 })
            }
            return new Response('[]', { status: 200 })
        }
        const gh = new GitHubProvider('github.com', 't', fetchImpl)

        const rows = await gh.getMyMrs(TODAY)
        expect(rows).toHaveLength(1)
        expect(rows[0]!.iid).toBe(4)
    })
})

describe('getReviews', () => {
    const me = { id: 1, username: 'dev' }

    it('shapes a review request', async () => {
        const gh = new GitHubProvider(
            'github.com',
            't',
            routedFetch({
                'search/issues': {
                    items: [
                        {
                            number: 54,
                            title: 'feat: balance inquiry',
                            html_url: 'https://github.com/acme/web/pull/54',
                            updated_at: '2026-08-28T08:00:00Z',
                            repository_url: 'https://api.github.com/repos/acme/web',
                            user: { login: 'teammate' },
                        },
                    ],
                },
                '/reviews': [{ state: 'APPROVED', user: { login: 'dev' } }],
            })
        )

        const [row] = await gh.getReviews(me, TODAY)
        expect(row).toMatchObject({
            provider: 'github',
            project: 'acme/web',
            iid: 54,
            author: 'teammate',
            fresh: true,
            approvedByMe: true,
        })
    })

    it('searches for pull requests that requested my review', async () => {
        const urls: string[] = []
        const fetchImpl: FetchLike = async (url: string) => {
            urls.push(url)
            return new Response(JSON.stringify({ items: [] }), { status: 200 })
        }
        const gh = new GitHubProvider('github.com', 't', fetchImpl)

        await gh.getReviews(me, TODAY)
        const query = decodeURIComponent(urls[0]!).replace(/\+/g, ' ')
        expect(query).toContain('is:pr is:open review-requested:dev')
    })

    it('marks a review older than a week as not fresh', async () => {
        const gh = new GitHubProvider(
            'github.com',
            't',
            routedFetch({
                'search/issues': {
                    items: [
                        {
                            number: 12,
                            title: 'chore: bump deps',
                            html_url: 'u',
                            updated_at: '2026-08-01T08:00:00Z',
                            repository_url: 'https://api.github.com/repos/acme/web',
                            user: { login: 'teammate' },
                        },
                    ],
                },
                '/reviews': [],
            })
        )

        const [row] = await gh.getReviews(me, TODAY)
        expect(row).toMatchObject({ fresh: false, approvedByMe: false })
    })

    it('sorts the newest review request first', async () => {
        const gh = new GitHubProvider(
            'github.com',
            't',
            routedFetch({
                'search/issues': {
                    items: [
                        {
                            number: 1,
                            title: 'older',
                            html_url: 'u',
                            updated_at: '2026-08-25T08:00:00Z',
                            repository_url: 'https://api.github.com/repos/acme/web',
                            user: { login: 'teammate' },
                        },
                        {
                            number: 2,
                            title: 'newer',
                            html_url: 'u',
                            updated_at: '2026-08-27T08:00:00Z',
                            repository_url: 'https://api.github.com/repos/acme/web',
                            user: { login: 'teammate' },
                        },
                    ],
                },
                '/reviews': [],
            })
        )

        const rows = await gh.getReviews(me, TODAY)
        expect(rows.map((row) => row.iid)).toEqual([2, 1])
    })
})
