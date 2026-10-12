import type { WebhookKind } from '../../src/notify/notify.types'
import type { ProviderKind } from '../../src/types/standup.types'

export interface AppCredentials {
    clientId: string
    clientSecret: string
}

export interface RemoteConfig {
    baseUrl: URL
    blockedAddresses: string[]
    databasePath: string
    encryptionKey: Buffer
    github?: AppCredentials
    githubAppSlug?: string
    gitlab?: AppCredentials
    port: number
}

export interface Account {
    id: string
    accessToken: string
    connectionId: string
    expiresAt: number | null
    host: string
    provider: ProviderKind
    refreshToken: string | null
    // 'oauth' accounts can be refreshed through our upstream app; 'pat'
    // accounts carry a token the user pasted and never expire on our side.
    source: 'oauth' | 'pat'
    username: string
}

export type NewAccount = Omit<Account, 'id'>

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

export interface UpstreamTokens {
    accessToken: string
    expiresAt: number | null
    refreshToken: string | null
}
