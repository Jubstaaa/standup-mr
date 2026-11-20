import { describe, expect, it } from 'bun:test'

import type { FetchLike } from '../../standup.types'
import { GitHubProvider } from '../github/github'
import { GitLabProvider } from '../gitlab/gitlab'

import { JSON_BYTES_CAP, LOG_BYTES_CAP, readJsonCapped, readTail } from './http'

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

        expect(tail).toHaveLength(1000)
        expect(tail.endsWith('error: the end')).toBe(true)
    })
})

describe('readJsonCapped', () => {
    it('parses a body under the cap', async () => {
        await expect(
            readJsonCapped(streamed('{"a":1}'), 100, 'h')
        ).resolves.toEqual({ a: 1 })
    })

    it('refuses a body over the cap instead of buffering it', async () => {
        const body = JSON.stringify({ blob: 'x'.repeat(5000) })
        await expect(readJsonCapped(streamed(body), 1000, 'h')).rejects.toThrow(
            /h sent more than/
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

        expect(log.length).toBe(LOG_BYTES_CAP)
        expect(log.endsWith('error: boom')).toBe(true)
    })

    it('caps a GitHub job log served inline', async () => {
        const gh = new GitHubProvider('github.com', 't', async () =>
            streamed(huge)
        )

        const log = await gh.getLogText('repos/a/b/actions/jobs/1/logs')

        expect(log.length).toBe(LOG_BYTES_CAP)
    })

    it('caps a GitLab job trace', async () => {
        const gl = new GitLabProvider('h', 't', async () => streamed(huge))

        const trace = await gl.getText('projects/1/jobs/2/trace')

        expect(trace.length).toBe(LOG_BYTES_CAP)
        expect(trace.endsWith('error: boom')).toBe(true)
    })

    it('refuses an oversized GitLab json response', async () => {
        const body = JSON.stringify(['x'.repeat(JSON_BYTES_CAP)])
        const gl = new GitLabProvider('h', 't', async () => streamed(body))

        await expect(gl.getJson('events')).rejects.toThrow(/sent more than/)
    })

    it('refuses an oversized GitHub json response', async () => {
        const body = JSON.stringify(['x'.repeat(JSON_BYTES_CAP)])
        const gh = new GitHubProvider('github.com', 't', async () =>
            streamed(body)
        )

        await expect(gh.getJson('user')).rejects.toThrow(/sent more than/)
    })
})
