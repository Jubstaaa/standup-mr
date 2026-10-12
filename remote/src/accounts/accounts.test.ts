import { randomBytes } from 'node:crypto'

import { beforeEach, describe, expect, test } from 'bun:test'

import { Store } from '../store/store'
import { startConnection } from '../store/store.fixtures'
import type { UpstreamApp } from '../upstream/upstream'
import type { UpstreamTokens } from '../upstream/upstream.types'

import { AccountError, createTokenRefresher, pickAccount } from './accounts'
import type { Account } from './accounts.types'

function account(overrides: Partial<Account>): Account {
    return {
        id: 'a',
        connectionId: 'c',
        provider: 'github',
        host: 'github.com',
        username: 'ilker',
        source: 'pat',
        accessToken: 'token',
        refreshToken: null,
        expiresAt: null,
        ...overrides,
    }
}

const github = account({ id: 'gh' })
const work = account({
    id: 'gl',
    provider: 'gitlab',
    host: 'git.example.com',
})

describe('pickAccount', () => {
    test('uses the only account without asking', () => {
        expect(pickAccount([github], {})).toBe(github)
    })

    test('picks by provider or by host', () => {
        expect(pickAccount([github, work], { provider: 'gitlab' })).toBe(work)
        expect(pickAccount([github, work], { host: 'GitHub.com' })).toBe(github)
    })

    test('refuses to guess between several and lists them', () => {
        expect(() => pickAccount([github, work], {})).toThrow(
            /github · github.com · ilker; gitlab · git.example.com · ilker/
        )
    })

    test('reports no match and no accounts', () => {
        expect(() => pickAccount([github], { provider: 'gitlab' })).toThrow(
            /No linked account matches/
        )
        expect(() => pickAccount([], {})).toThrow(AccountError)
    })
})

describe('createTokenRefresher', () => {
    let store: Store
    let linked: Account
    let refreshCalls: number
    let refreshResult: () => Promise<UpstreamTokens>

    const githubApp: UpstreamApp = {
        kind: 'github',
        host: 'github.com',
        clientId: 'id',
        clientSecret: 'secret',
        isInstance: false,
        isVerified: true,
        scopes: [],
    }

    const upstream = () => ({
        resolve: () => githubApp,
        refresh: async () => {
            refreshCalls += 1
            return refreshResult()
        },
    })

    const noUpstream = {
        resolve: () => undefined,
        refresh: async (): Promise<UpstreamTokens> => {
            throw new Error('unused')
        },
    }

    beforeEach(() => {
        store = new Store(':memory:', randomBytes(32))
        refreshCalls = 0
        refreshResult = async () => ({
            accessToken: 'new',
            refreshToken: 'refresh-2',
            expiresAt: 38_800_000,
        })
        linked = store.addAccount({
            connectionId: startConnection(store).connectionId,
            provider: 'github',
            host: 'github.com',
            username: 'ilker',
            source: 'oauth',
            accessToken: 'old',
            refreshToken: 'refresh',
            expiresAt: 10_000_000,
        })
    })

    test('keeps a token that is still valid', async () => {
        const fresh = createTokenRefresher(upstream(), store)
        expect(await fresh(linked, 0)).toBe('old')
        expect(refreshCalls).toBe(0)
    })

    test('refreshes a token about to expire and stores the new one', async () => {
        const fresh = createTokenRefresher(upstream(), store)
        expect(await fresh(linked, 9_999_000)).toBe('new')
        const [stored] = store.listAccounts(linked.connectionId)
        expect(stored!.accessToken).toBe('new')
        expect(stored!.refreshToken).toBe('refresh-2')
    })

    test('spends a single-use refresh token once for concurrent calls', async () => {
        const fresh = createTokenRefresher(upstream(), store)
        const tokens = await Promise.all([
            fresh(linked, 9_999_000),
            fresh(linked, 9_999_000),
        ])
        expect(tokens).toEqual(['new', 'new'])
        expect(refreshCalls).toBe(1)
    })

    test('asks for a reconnect when the refresh is refused', async () => {
        refreshResult = async () => {
            throw new Error('bad_refresh_token')
        }
        const fresh = createTokenRefresher(upstream(), store)
        await expect(fresh(linked, 9_999_000)).rejects.toThrow(/Reconnect/)
    })

    test('never refreshes a pasted token', async () => {
        const fresh = createTokenRefresher(noUpstream, store)
        const pat = account({ source: 'pat', expiresAt: 1 })
        expect(await fresh(pat, 10)).toBe('token')
    })
})
