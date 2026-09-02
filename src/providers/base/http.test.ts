import { describe, expect, it } from 'bun:test'

import {
    ApiError,
    RETRY_ATTEMPTS,
    RETRY_BACKOFF_MS,
    assertUsable,
    buildUrl,
    sendWithRetry,
    unreachable,
} from './http'

import type { FetchLike } from '../../types/standup.types'

function response(
    status: number,
    headers: Record<string, string> = {}
): Response {
    return new Response('', { status, headers })
}

describe('assertUsable', () => {
    it('passes an ok response through', () => {
        expect(() => assertUsable(response(200), 'h')).not.toThrow()
    })

    it('passes a 404 through so a missing resource stays a null', () => {
        expect(() => assertUsable(response(404), 'h')).not.toThrow()
    })

    it('throws on 401 and names the token', () => {
        expect(() => assertUsable(response(401), 'gitlab.example.com')).toThrow(
            /gitlab\.example\.com.*token/i
        )
    })

    it('throws on a plain 403 and says access is missing', () => {
        expect(() => assertUsable(response(403), 'h')).toThrow(/access/i)
    })

    it('reports a rate limit when the remaining header is zero', () => {
        expect(() =>
            assertUsable(
                response(403, { 'x-ratelimit-remaining': '0' }),
                'api.github.com'
            )
        ).toThrow(/rate limit/i)
    })

    it('reports a rate limit on 429 too', () => {
        expect(() =>
            assertUsable(response(429, { 'ratelimit-remaining': '0' }), 'h')
        ).toThrow(/rate limit/i)
    })

    it('includes the reset time when the header is present', () => {
        expect(() =>
            assertUsable(
                response(403, {
                    'x-ratelimit-remaining': '0',
                    'x-ratelimit-reset': '1787644800',
                }),
                'h'
            )
        ).toThrow(/2026-08-2\dT/)
    })

    it('reports a secondary rate limit as a rate limit, not a permissions problem', () => {
        expect(() =>
            assertUsable(
                response(403, {
                    'retry-after': '60',
                    'x-ratelimit-remaining': '4998',
                }),
                'api.github.com'
            )
        ).toThrow(/rate limit/i)
    })

    it('names the retry delay so the wait is knowable', () => {
        expect(() =>
            assertUsable(response(429, { 'retry-after': '60' }), 'h')
        ).toThrow(/retry after 60s/)
    })

    it('throws an ApiError for any other failing status', () => {
        expect(() => assertUsable(response(500), 'h')).toThrow(ApiError)
        expect(() => assertUsable(response(500), 'h')).toThrow(/500/)
    })
})

describe('buildUrl', () => {
    it('joins the api base and the path', () => {
        expect(buildUrl('https://api.github.com', 'user')).toBe(
            'https://api.github.com/user'
        )
    })

    it('omits the query when there are no params', () => {
        expect(buildUrl('https://h/api/v4', 'merge_requests', {})).toBe(
            'https://h/api/v4/merge_requests'
        )
    })

    it('encodes every param value', () => {
        expect(
            buildUrl('https://api.github.com', 'search/issues', {
                q: 'is:pr author:dev',
                page: 2,
            })
        ).toBe(
            'https://api.github.com/search/issues?q=is%3Apr+author%3Adev&page=2'
        )
    })
})

describe('unreachable', () => {
    it('names the host and keeps the cause text', () => {
        const error = unreachable('gitlab.example.com', new Error('offline'))
        expect(error).toBeInstanceOf(ApiError)
        expect(error.message).toMatch(/gitlab\.example\.com/)
        expect(error.message).toMatch(/offline/)
    })
})

describe('sendWithRetry', () => {
    function counter(responses: Array<Response | Error>): {
        fetchImpl: FetchLike
        calls: () => number
    } {
        let index = 0
        const fetchImpl: FetchLike = async () => {
            const next = responses[Math.min(index, responses.length - 1)]!
            index += 1
            if (next instanceof Error) throw next
            return new Response('', {
                status: next.status,
                headers: next.headers,
            })
        }
        return { fetchImpl, calls: () => index }
    }

    const noSleep = async () => {}

    it('returns a first-try success without retrying', async () => {
        const { fetchImpl, calls } = counter([response(200)])
        const result = await sendWithRetry(
            fetchImpl,
            'https://h/x',
            undefined,
            'h',
            noSleep
        )
        expect(result.status).toBe(200)
        expect(calls()).toBe(1)
    })

    it('retries a 503 and returns the success that follows', async () => {
        const { fetchImpl, calls } = counter([response(503), response(200)])
        const result = await sendWithRetry(
            fetchImpl,
            'https://h/x',
            undefined,
            'h',
            noSleep
        )
        expect(result.status).toBe(200)
        expect(calls()).toBe(2)
    })

    it('retries a thrown network error and returns the success that follows', async () => {
        const { fetchImpl, calls } = counter([
            new Error('socket hang up'),
            response(200),
        ])
        const result = await sendWithRetry(
            fetchImpl,
            'https://h/x',
            undefined,
            'h',
            noSleep
        )
        expect(result.status).toBe(200)
        expect(calls()).toBe(2)
    })

    it('gives the 5xx back once the attempts run out, so assertUsable still throws', async () => {
        const { fetchImpl, calls } = counter([response(503)])
        const result = await sendWithRetry(
            fetchImpl,
            'https://h/x',
            undefined,
            'h',
            noSleep
        )
        expect(result.status).toBe(503)
        expect(calls()).toBe(RETRY_ATTEMPTS)
        expect(() => assertUsable(result, 'h')).toThrow(/503/)
    })

    it('throws unreachable once a thrown error survives every attempt', async () => {
        const { fetchImpl, calls } = counter([new Error('offline')])
        await expect(
            sendWithRetry(fetchImpl, 'https://h/x', undefined, 'h', noSleep)
        ).rejects.toThrow(/offline/)
        expect(calls()).toBe(RETRY_ATTEMPTS)
    })

    it('does not retry a 401, so a bad token still fails on the first call', async () => {
        const { fetchImpl, calls } = counter([response(401)])
        const result = await sendWithRetry(
            fetchImpl,
            'https://h/x',
            undefined,
            'h',
            noSleep
        )
        expect(result.status).toBe(401)
        expect(calls()).toBe(1)
    })

    it('does not retry a 429, whose reset time is the real answer', async () => {
        const { fetchImpl, calls } = counter([
            response(429, { 'ratelimit-remaining': '0' }),
        ])
        const result = await sendWithRetry(
            fetchImpl,
            'https://h/x',
            undefined,
            'h',
            noSleep
        )
        expect(result.status).toBe(429)
        expect(calls()).toBe(1)
    })

    it('does not retry a 404, which callers read as an absent resource', async () => {
        const { fetchImpl, calls } = counter([response(404)])
        const result = await sendWithRetry(
            fetchImpl,
            'https://h/x',
            undefined,
            'h',
            noSleep
        )
        expect(result.status).toBe(404)
        expect(calls()).toBe(1)
    })

    it('backs off between attempts instead of hammering the host', async () => {
        const waits: number[] = []
        const { fetchImpl } = counter([response(503)])
        await sendWithRetry(
            fetchImpl,
            'https://h/x',
            undefined,
            'h',
            async ms => {
                waits.push(ms)
            }
        )
        expect(waits).toEqual(RETRY_BACKOFF_MS)
    })

    it('passes the init through on every attempt', async () => {
        const seen: Array<RequestInit | undefined> = []
        let index = 0
        const fetchImpl: FetchLike = async (_url, init) => {
            seen.push(init)
            index += 1
            return response(index === 1 ? 503 : 200)
        }
        const init = { headers: { authorization: 'Bearer t' } }
        await sendWithRetry(fetchImpl, 'https://h/x', init, 'h', noSleep)
        expect(seen).toEqual([init, init])
    })
})
