export const PAYLOAD_FIELD = {
    'slack': 'text',
    'discord': 'content',
    'google-chat': 'text',
} as const

export const WEBHOOK_KINDS = Object.keys(PAYLOAD_FIELD) as Array<
    keyof typeof PAYLOAD_FIELD
>
