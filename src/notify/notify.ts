import { toChatText } from '../render/chat'
import type { FetchLike } from '../types/standup.types'

import { PAYLOAD_FIELD } from './notify.constants'
import type { WebhookKind } from './notify.types'

export async function postWebhook(
    url: string,
    text: string,
    kind: WebhookKind = 'slack',
    fetchImpl: FetchLike = fetch
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
        body: JSON.stringify({ [field]: toChatText(text, kind) }),
    })

    if (!response.ok) {
        throw new Error(
            `Webhook rejected the message: HTTP ${response.status}.`
        )
    }
}

const WEBHOOK_HOSTS: Record<string, WebhookKind> = {
    'hooks.slack.com': 'slack',
    'chat.googleapis.com': 'google-chat',
    'discord.com': 'discord',
    'discordapp.com': 'discord',
    'ptb.discord.com': 'discord',
    'canary.discord.com': 'discord',
}

export function inferWebhookKind(url: string): WebhookKind | null {
    try {
        return WEBHOOK_HOSTS[new URL(url).hostname] ?? null
    } catch {
        return null
    }
}
