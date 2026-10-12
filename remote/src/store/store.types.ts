import type { WebhookKind } from '../../../src/notify/notify.types'
import type { ProviderKind } from '../../../src/types/standup.types'

export interface Webhook {
    kind: WebhookKind
    url: string
}

// days is a cron day-of-week list (0 is Sunday), time is HH:MM in timezone.
export interface ScheduleSettings {
    days: string
    time: string
    timezone: string
}

export interface Schedule extends ScheduleSettings {
    connectionId: string
    lastError: string | null
    lastSentAt: number | null
    nextRunAt: number
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

export interface UpstreamLogin {
    codeVerifier: string
    pending: PendingAuthorization
}

// An OAuth application someone registered on a self-hosted GitLab or
// GitHub Enterprise, shared by everyone who signs in to that host.
export interface Instance {
    clientId: string
    clientSecret: string
    host: string
    kind: ProviderKind
    verifiedAt: number | null
}
