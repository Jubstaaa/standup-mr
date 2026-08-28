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
