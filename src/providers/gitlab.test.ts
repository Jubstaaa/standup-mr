import { describe, expect, it, mock } from 'bun:test'

import type { FetchLike } from '../types'
import { GitLabProvider } from './gitlab'

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
        expect(headers.get('private-token')).toBe('tok')
        return jsonResponse(pages[Math.min(calls.length - 1, pages.length - 1)])
    })
    return Object.assign(impl as unknown as FetchLike, { calls })
}

describe('GitLabProvider transport', () => {
    it('builds the API url and sends the token header', async () => {
        const fetchImpl = recordingFetch([{ id: 7 }])
        const gl = new GitLabProvider('gitlab.example.com', 'tok', fetchImpl)

        await expect(gl.getJson('user')).resolves.toEqual({ id: 7 })
        expect(fetchImpl.calls[0]).toBe('https://gitlab.example.com/api/v4/user')
    })

    it('encodes query parameters', async () => {
        const fetchImpl = recordingFetch([[]])
        const gl = new GitLabProvider('gitlab.example.com', 'tok', fetchImpl)

        await gl.getJson('events', { after: '2026-08-01', per_page: 100 })
        expect(fetchImpl.calls[0]).toContain('after=2026-08-01')
        expect(fetchImpl.calls[0]).toContain('per_page=100')
    })

    it('returns null when the transport throws', async () => {
        const boom: FetchLike = async () => {
            throw new Error('boom')
        }
        const gl = new GitLabProvider('gitlab.example.com', 'tok', boom)

        await expect(gl.getJson('user')).resolves.toBeNull()
    })

    it('returns null on a non-ok status', async () => {
        const notFound: FetchLike = async () =>
            new Response(JSON.stringify({ message: '404 Not Found' }), { status: 404 })
        const gl = new GitLabProvider('gitlab.example.com', 'tok', notFound)

        await expect(gl.getJson('user')).resolves.toBeNull()
    })

    it('returns an empty string from getText when the transport throws', async () => {
        const boom: FetchLike = async () => {
            throw new Error('boom')
        }
        const gl = new GitLabProvider('gitlab.example.com', 'tok', boom)

        await expect(gl.getText('jobs/1/trace')).resolves.toBe('')
    })

    it('stops paging on a short page', async () => {
        const full = Array.from({ length: 100 }, (_, i) => ({ i }))
        const fetchImpl = recordingFetch([full, [{ i: 100 }]])
        const gl = new GitLabProvider('gitlab.example.com', 'tok', fetchImpl)

        const rows = await gl.getPaged('events')
        expect(rows).toHaveLength(101)
        expect(fetchImpl.calls).toHaveLength(2)
    })

    it('respects the page cap', async () => {
        const full = Array.from({ length: 100 }, (_, i) => ({ i }))
        const fetchImpl = recordingFetch([full])
        const gl = new GitLabProvider('gitlab.example.com', 'tok', fetchImpl)

        const rows = await gl.getPaged('events', {}, 3)
        expect(rows).toHaveLength(300)
        expect(fetchImpl.calls).toHaveLength(3)
    })
})
