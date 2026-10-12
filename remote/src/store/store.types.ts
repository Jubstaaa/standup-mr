import type { WebhookKind } from '../../../src/notify/notify.types'

export interface Webhook {
    kind: WebhookKind
    url: string
}

export interface PendingAuthorization {
    id: string
    clientId: string
    codeChallenge: string
    connectionId: string
    createdAt: number
    finishedRedirect: string | null
    redirectUri: string
    resource: string | null
    scopes: string[]
    state: string | null
}

export interface NewPending {
    browserSecret: string
    clientId: string
    codeChallenge: string
    pendingId: string
    redirectUri: string
    resource: string | null
    scopes: string[]
    state: string | null
}

export interface AuthCode {
    clientId: string
    codeChallenge: string
    connectionId: string
    expiresAt: number
    redirectUri: string
    resource: string | null
    scopes: string[]
}

export interface StoredToken {
    clientId: string
    connectionId: string
    expiresAt: number
    family: string
    kind: 'access' | 'refresh'
    resource: string | null
    scopes: string[]
    usedAt: number | null
}
