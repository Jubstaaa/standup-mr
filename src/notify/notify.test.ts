import { describe, expect, it } from 'bun:test'

import { WEBHOOK_KINDS } from './notify.constants'
import { inferWebhookKind, postWebhook } from './notify'
import type { FetchLike } from '../types/standup.types'

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

describe('inferWebhookKind', () => {
    it('recognises a Slack webhook by its host', () => {
        expect(inferWebhookKind('https://hooks.slack.com/services/T0/B0/xxx')).toBe('slack')
    })

    it('recognises a Discord webhook by its host', () => {
        expect(inferWebhookKind('https://discord.com/api/webhooks/1/xxx')).toBe('discord')
        expect(inferWebhookKind('https://discordapp.com/api/webhooks/1/xxx')).toBe('discord')
    })

    it('returns null for a host it does not know, rather than guessing', () => {
        expect(inferWebhookKind('https://hooks.example.com/abc')).toBeNull()
    })

    it('returns null for something that is not a url at all', () => {
        expect(inferWebhookKind('not a url')).toBeNull()
    })
})

describe('Google Chat support', () => {
    it('sends the text field Google Chat expects', async () => {
        let body = ''
        await postWebhook('https://chat.googleapis.com/v1/spaces/A/messages?key=k', 'note',
            'google-chat',
            async (_url, init) => {
                body = String(init?.body)
                return new Response('', { status: 200 })
            })

        expect(JSON.parse(body)).toEqual({ text: 'note' })
    })

    it('recognises a Google Chat webhook by its host', () => {
        expect(inferWebhookKind('https://chat.googleapis.com/v1/spaces/A/messages?key=k')).toBe(
            'google-chat'
        )
    })

    it('lists every implemented kind, so callers and the CLI stay in step', () => {
        expect([...WEBHOOK_KINDS].sort()).toEqual(['discord', 'google-chat', 'slack'])
    })
})
