import { describe, expect, it } from 'bun:test'

import { postWebhook } from './notify'
import type { FetchLike } from './standup.types'

function recordingFetch() {
    const sent: Array<{ url: string; body: unknown; contentType: string | null }> = []
    const impl: FetchLike = async (url, init) => {
        sent.push({
            url,
            body: JSON.parse(String(init?.body)),
            contentType: new Headers(init?.headers).get('content-type'),
        })
        return new Response('ok', { status: 200 })
    }
    return { impl, sent }
}

describe('postWebhook', () => {
    it('uses the text field for Slack', async () => {
        const { impl, sent } = recordingFetch()
        await postWebhook('https://hooks.example.com/a', 'hello', 'slack', impl)

        expect(sent[0]!.body).toEqual({ text: 'hello' })
        expect(sent[0]!.contentType).toBe('application/json')
    })

    it('uses the content field for Discord', async () => {
        const { impl, sent } = recordingFetch()
        await postWebhook('https://discord.example.com/b', 'hello', 'discord', impl)

        expect(sent[0]!.body).toEqual({ content: 'hello' })
    })

    it('posts to the given url', async () => {
        const { impl, sent } = recordingFetch()
        await postWebhook('https://hooks.example.com/xyz', 'hi', 'slack', impl)

        expect(sent[0]!.url).toBe('https://hooks.example.com/xyz')
    })

    it('rejects an unknown kind', async () => {
        const { impl } = recordingFetch()
        await expect(
            postWebhook('https://x', 'hi', 'teams' as 'slack', impl)
        ).rejects.toThrow(/teams/)
    })

    it('rejects when the webhook returns an error status', async () => {
        const failing: FetchLike = async () => new Response('no', { status: 403 })
        await expect(postWebhook('https://x', 'hi', 'slack', failing)).rejects.toThrow(/403/)
    })
})
