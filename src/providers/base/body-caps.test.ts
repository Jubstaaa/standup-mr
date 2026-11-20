import { describe, expect, it } from 'bun:test'

import type { FetchLike } from '../../standup.types'
import { GitHubProvider } from '../github/github'
import { GitLabProvider } from '../gitlab/gitlab'

import {
    ApiError,
    JSON_BYTES_CAP,
    LOG_BYTES_CAP,
    readJsonCapped,
    readJsonResponse,
    readTail,
} from './http'

// A body streamed in small chunks, as a real socket delivers it.
function streamed(text: string, init: ResponseInit = {}): Response {
    const bytes = new TextEncoder().encode(text)
    const body = new ReadableStream<Uint8Array>({
        start(controller) {
            for (let at = 0; at < bytes.length; at += 4096) {
                controller.enqueue(bytes.subarray(at, at + 4096))
            }
            controller.close()
        },
    })
    return new Response(body, { status: 200, ...init })
}

describe('readTail', () => {
    it('returns a small body whole', async () => {
        await expect(readTail(streamed('hello'), 100)).resolves.toBe('hello')
    })

    it('keeps only the last bytes of an oversized body', async () => {
        const text = `${'x'.repeat(50_000)}error: the end`
        const tail = await readTail(streamed(text), 1000)

        expect(tail).toStartWith('[log truncated to its last 1000 bytes]\n')
        expect(tail.endsWith(`${'x'.repeat(986)}error: the end`)).toBe(true)
    })
})

describe('readJsonCapped', () => {
    it('parses a body under the cap', async () => {
        await expect(
            readJsonCapped(streamed('{"a":1}'), 100, 'h', 'user')
        ).resolves.toEqual({ a: 1 })
    })

    it('refuses a body over the cap instead of buffering it', async () => {
        const body = JSON.stringify({ blob: 'x'.repeat(5000) })
        await expect(
            readJsonCapped(streamed(body), 1000, 'h', 'events')
        ).rejects.toThrow(/h sent more than 1000 bytes for events/)
    })

    it('names a non-JSON answer without echoing the parser error', async () => {
        const page = streamed('<html>sign in</html>', {
            headers: { 'content-type': 'text/html' },
        })
        const failure = readJsonCapped(page, 1000, 'h', 'user')

        await expect(failure).rejects.toBeInstanceOf(ApiError)
        await expect(failure).rejects.toThrow(
            'h answered user with something that is not JSON (content-type text/html).'
        )
    })
})

describe('provider body caps', () => {
    const huge = `${'x'.repeat(LOG_BYTES_CAP + 10_000)}\nerror: boom`

    it('caps a GitHub job log fetched from its blob redirect', async () => {
        const fetchImpl: FetchLike = async url =>
            url.startsWith('https://blob.example.com')
                ? streamed(huge)
                : new Response(null, {
                      status: 302,
                      headers: { location: 'https://blob.example.com/log' },
                  })
        const gh = new GitHubProvider('github.com', 't', fetchImpl)

        const log = await gh.getLogText('repos/a/b/actions/jobs/1/logs')

        expect(log).toStartWith('[log truncated to its last 2 MiB]\n')
        expect(log.endsWith('error: boom')).toBe(true)
    })

    it('caps a GitHub job log served inline', async () => {
        const gh = new GitHubProvider('github.com', 't', async () =>
            streamed(huge)
        )

        const log = await gh.getLogText('repos/a/b/actions/jobs/1/logs')

        expect(log).toStartWith('[log truncated')
    })

    it('caps a GitLab job trace', async () => {
        const gl = new GitLabProvider('h', 't', async () => streamed(huge))

        const trace = await gl.getText('projects/1/jobs/2/trace')

        expect(trace).toStartWith('[log truncated to its last 2 MiB]\n')
        expect(trace.endsWith('error: boom')).toBe(true)
    })

    it('refuses an oversized GitLab json response', async () => {
        const body = JSON.stringify(['x'.repeat(JSON_BYTES_CAP)])
        const gl = new GitLabProvider('h', 't', async () => streamed(body))

        await expect(gl.getJson('events')).rejects.toThrow(
            /sent more than 8 MiB for events/
        )
    })

    it('refuses an oversized GitHub json response', async () => {
        const body = JSON.stringify(['x'.repeat(JSON_BYTES_CAP)])
        const gh = new GitHubProvider('github.com', 't', async () =>
            streamed(body)
        )

        await expect(gh.getJson('user')).rejects.toThrow(/sent more than/)
    })
})

describe('readJsonResponse', () => {
    it('parses a body within the JSON cap', async () => {
        expect(
            await readJsonResponse(
                streamed('{"a":1}'),
                'git.example.com',
                'user'
            )
        ).toEqual({ a: 1 })
    })

    it('keeps the cap message when a body is too large', async () => {
        const big = streamed(`"${'x'.repeat(JSON_BYTES_CAP)}"`)
        await expect(
            readJsonResponse(big, 'git.example.com', 'user')
        ).rejects.toThrow(/more than 8 MiB/)
    })

    it('reports a connection that drops mid-body as unreachable', async () => {
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new TextEncoder().encode('{"a":'))
                controller.error(new Error('socket hang up'))
            },
        })
        const error = await readJsonResponse(
            new Response(body),
            'git.example.com',
            'user'
        ).catch((caught: unknown) => caught)
        expect(error).toBeInstanceOf(ApiError)
        expect(String(error)).toMatch(
            /Could not reach git\.example\.com: socket hang up/
        )
    })
})

// A body produced only when the reader asks for it, as a socket under
// backpressure does, so the test can see how much was actually pulled.
function pulledOnDemand(total: number, chunk = 64 * 1024) {
    let produced = 0
    let cancelled = false
    const body = new ReadableStream<Uint8Array>(
        {
            pull(controller) {
                if (produced >= total) return controller.close()
                produced += chunk
                controller.enqueue(new Uint8Array(chunk).fill(0x78))
            },
            cancel() {
                cancelled = true
            },
        },
        { highWaterMark: 0 }
    )
    return {
        cancelled: () => cancelled,
        produced: () => produced,
        response: new Response(body),
    }
}

describe('memory bound', () => {
    const MIB = 1024 * 1024

    it('stops pulling a JSON body once it passes the cap', async () => {
        const source = pulledOnDemand(100 * MIB)

        await expect(
            readJsonCapped(source.response, MIB, 'h', 'events')
        ).rejects.toThrow(/more than 1 MiB/)
        expect(source.produced()).toBeLessThanOrEqual(MIB + 2 * 64 * 1024)
    })

    it('cancels the body after a capped read', async () => {
        const source = pulledOnDemand(100 * MIB)

        await expect(
            readJsonCapped(source.response, MIB, 'h', 'events')
        ).rejects.toThrow()
        expect(source.cancelled()).toBe(true)
    })
})
