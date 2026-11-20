import { describe, expect, it } from 'bun:test'

import type { FetchLike } from '../../standup.types'
import { GitHubProvider } from '../github/github'
import { GitLabProvider } from '../gitlab/gitlab'

import {
    ApiError,
    JSON_BYTES_CAP,
    LOG_BYTES_CAP,
    readJsonCapped,
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
