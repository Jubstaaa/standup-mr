import { describe, expect, it } from 'bun:test'

import { ApiError, assertUsable, buildUrl, unreachable } from './http'

function response(status: number, headers: Record<string, string> = {}): Response {
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
            assertUsable(response(403, { 'x-ratelimit-remaining': '0' }), 'api.github.com')
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
                response(403, { 'retry-after': '60', 'x-ratelimit-remaining': '4998' }),
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
        expect(buildUrl('https://api.github.com', 'user')).toBe('https://api.github.com/user')
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
        ).toBe('https://api.github.com/search/issues?q=is%3Apr+author%3Adev&page=2')
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
