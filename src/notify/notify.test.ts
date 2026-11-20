import { describe, expect, it } from 'bun:test'

import type { FetchLike } from '../standup.types'

import { inferWebhookKind, postWebhook } from './notify'
import { WEBHOOK_KINDS } from './notify.constants'

function recordingFetch() {
    const sent: Array<{
        url: string
        body: unknown
        contentType: string | null
    }> = []
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
        await postWebhook(
            'https://discord.example.com/b',
            'hello',
            'discord',
            impl
        )

        expect(sent[0]!.body).toEqual({
            content: 'hello',
            allowed_mentions: { parse: [] },
        })
    })

    it('stops Discord from resolving @everyone or role mentions in the note', async () => {
        const { impl, sent } = recordingFetch()
        await postWebhook(
            'https://discord.com/api/webhooks/1/x',
            'fix: @everyone <@&42>',
            'discord',
            impl
        )

        expect(sent[0]!.body).toMatchObject({
            content: 'fix: @everyone <@&42>',
            allowed_mentions: { parse: [] },
        })
    })

    it('does not follow a redirect away from the webhook host', async () => {
        let redirect: RequestInit['redirect']
        const moved: FetchLike = async (_url, init) => {
            redirect = init?.redirect
            return new Response(null, {
                status: 302,
                headers: { location: 'http://169.254.169.254/' },
            })
        }

        await expect(
            postWebhook(
                'https://hooks.slack.com/services/x',
                'hi',
                'slack',
                moved
            )
        ).rejects.toThrow(/302/)
        expect(redirect).toBe('manual')
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
        const failing: FetchLike = async () =>
            new Response('no', { status: 403 })
        await expect(
            postWebhook('https://x', 'hi', 'slack', failing)
        ).rejects.toThrow(/403/)
    })
})

describe('inferWebhookKind', () => {
    it('recognises a Slack webhook by its host', () => {
        expect(
            inferWebhookKind('https://hooks.slack.com/services/T0/B0/xxx')
        ).toBe('slack')
    })

    it('recognises a Discord webhook by its host', () => {
        expect(inferWebhookKind('https://discord.com/api/webhooks/1/xxx')).toBe(
            'discord'
        )
        expect(
            inferWebhookKind('https://discordapp.com/api/webhooks/1/xxx')
        ).toBe('discord')
    })

    it('returns null for a host it does not know, rather than guessing', () => {
        expect(inferWebhookKind('https://hooks.example.com/abc')).toBeNull()
    })

    it('returns null for something that is not a url at all', () => {
        expect(inferWebhookKind('not a url')).toBeNull()
    })

    it('accepts only the webhook path on a known host', () => {
        expect(inferWebhookKind('https://hooks.slack.com/oauth/x')).toBeNull()
        expect(inferWebhookKind('https://discord.com/users/1')).toBeNull()
        expect(
            inferWebhookKind('https://chat.googleapis.com/v1/other')
        ).toBeNull()
        expect(
            inferWebhookKind('https://ptb.discord.com/api/webhooks/1/x')
        ).toBe('discord')
        expect(
            inferWebhookKind('https://hooks.slack.com/workflows/T0/A0/1/x')
        ).toBe('slack')
    })

    it('rejects plain http, credentials and custom ports', () => {
        expect(
            inferWebhookKind('http://hooks.slack.com/services/T0/B0/x')
        ).toBeNull()
        expect(
            inferWebhookKind('https://u:p@hooks.slack.com/services/T0/B0/x')
        ).toBeNull()
        expect(
            inferWebhookKind('https://hooks.slack.com:8443/services/T0/B0/x')
        ).toBeNull()
    })
})

describe('Google Chat support', () => {
    it('sends the text field Google Chat expects', async () => {
        let body = ''
        await postWebhook(
            'https://chat.googleapis.com/v1/spaces/A/messages?key=k',
            'note',
            'google-chat',
            async (_url, init) => {
                body = String(init?.body)
                return new Response('', { status: 200 })
            }
        )

        expect(JSON.parse(body)).toEqual({ text: 'note' })
    })

    it('recognises a Google Chat webhook by its host', () => {
        expect(
            inferWebhookKind(
                'https://chat.googleapis.com/v1/spaces/A/messages?key=k'
            )
        ).toBe('google-chat')
    })

    it('lists every implemented kind, so callers and the CLI stay in step', () => {
        expect([...WEBHOOK_KINDS].sort()).toEqual([
            'discord',
            'google-chat',
            'slack',
        ])
    })
})

describe('postWebhook formatting', () => {
    it('rewrites Markdown bold for Slack, which does not render **', async () => {
        let body = ''
        await postWebhook(
            'https://hooks.slack.com/x',
            '## Dün\n- **ready**',
            'slack',
            async (_u, init) => {
                body = String(init?.body)
                return new Response('', { status: 200 })
            }
        )

        expect(JSON.parse(body).text).toBe('*Dün*\n- *ready*')
    })

    it('sends Discord the Markdown untouched', async () => {
        let body = ''
        await postWebhook(
            'https://discord.com/api/webhooks/1/x',
            '## Dün\n- **ready**',
            'discord',
            async (_u, init) => {
                body = String(init?.body)
                return new Response('', { status: 200 })
            }
        )

        expect(JSON.parse(body).content).toBe('## Dün\n- **ready**')
    })
})
