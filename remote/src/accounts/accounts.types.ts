import type { ProviderKind } from '../../../src/types/standup.types'

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
