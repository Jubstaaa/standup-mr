import { PAYLOAD_FIELD } from './notify.constants'

export type WebhookKind = keyof typeof PAYLOAD_FIELD
