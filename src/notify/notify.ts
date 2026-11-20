import { timedFetch } from '../providers/base/http'
import { toChatText } from '../render/chat'
import type { FetchLike } from '../standup.types'

import { PAYLOAD_FIELD } from './notify.constants'
import type { WebhookKind } from './notify.types'

export async function postWebhook(
    url: string,
    text: string,
    kind: WebhookKind = 'slack',
    fetchImpl: FetchLike = timedFetch()
): Promise<void> {
    const field = PAYLOAD_FIELD[kind]
    if (!field) {
        throw new Error(
            `Unknown webhook kind "${kind}". Use one of: ${Object.keys(PAYLOAD_FIELD).join(', ')}.`
        )
    }

    const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            [field]: toChatText(text, kind),
            // The note quotes titles written by other people and text from an
            // LLM; neither may ping @everyone, a role or a user.
            ...(kind === 'discord' && { allowed_mentions: { parse: [] } }),
        }),
        // A webhook that answers with a redirect is not one we vetted.
        redirect: 'manual',
    })

    if (!response.ok) {
        throw new Error(
            `Webhook rejected the message: HTTP ${response.status}.`
        )
    }
}

interface WebhookEndpoint {
    host: string
    kind: WebhookKind
    pathPrefixes: readonly string[]
}

const SLACK_PATHS = ['/services/', '/workflows/', '/triggers/']
const DISCORD_PATHS = ['/api/webhooks/']

const WEBHOOK_ENDPOINTS: readonly WebhookEndpoint[] = [
    { host: 'hooks.slack.com', kind: 'slack', pathPrefixes: SLACK_PATHS },
    {
        host: 'chat.googleapis.com',
        kind: 'google-chat',
        pathPrefixes: ['/v1/spaces/'],
    },
    ...[
        'discord.com',
        'discordapp.com',
        'ptb.discord.com',
        'canary.discord.com',
    ].map(host => ({
        host,
        kind: 'discord' as const,
        pathPrefixes: DISCORD_PATHS,
    })),
]

// Doubles as the allow-list for a server that posts to a stored URL: only an
// https webhook path on a known chat host, with no credentials or custom port.
export function inferWebhookKind(url: string): WebhookKind | null {
    let parsed: URL
    try {
        parsed = new URL(url)
    } catch {
        return null
    }
    if (parsed.protocol !== 'https:') return null
    if (parsed.port || parsed.username || parsed.password) return null

    const endpoint = WEBHOOK_ENDPOINTS.find(
        candidate =>
            candidate.host === parsed.hostname &&
            candidate.pathPrefixes.some(prefix =>
                parsed.pathname.startsWith(prefix)
            )
    )
    return endpoint?.kind ?? null
}
