import { randomBytes } from 'node:crypto'

import { beforeEach, describe, expect, test } from 'bun:test'

import { AccountError, freshAccessToken, pickAccount } from './accounts'
import type { Account } from './remote.types'
import { Store } from './store'
import type { UpstreamApp } from './upstream'

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

describe('freshAccessToken', () => {
    const app: UpstreamApp = {
        kind: 'github',
        host: 'github.com',
        authorizeUrl: 'https://github.com/login/oauth/authorize',
        tokenUrl: 'https://github.com/login/oauth/access_token',
        clientId: 'id',
        clientSecret: 'secret',
    }
    let store: Store
    let linked: Account

    beforeEach(() => {
        store = new Store(':memory:', randomBytes(32))
        const { connectionId } = store.createPending(
            {
                clientId: 'claude',
                codeChallenge: 'c',
                redirectUri: 'https://claude.ai/cb',
                resource: null,
                scopes: [],
                state: null,
            },
            'pending',
            0
        )
        linked = store.addAccount({
            connectionId,
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
        expect(await freshAccessToken(linked, { github: app }, store, 0)).toBe(
            'old'
        )
    })

    test('refreshes a token about to expire and stores the new one', async () => {
        const fetchImpl = async () =>
            Response.json({
                access_token: 'new',
                refresh_token: 'refresh-2',
                expires_in: 28_800,
            })
        const token = await freshAccessToken(
            linked,
            { github: app },
            store,
            9_999_000,
            fetchImpl
        )
        expect(token).toBe('new')
        const [stored] = store.listAccounts(linked.connectionId)
        expect(stored!.accessToken).toBe('new')
        expect(stored!.refreshToken).toBe('refresh-2')
    })

    test('asks for a reconnect when the refresh is refused', async () => {
        const fetchImpl = async () =>
            Response.json({ error: 'bad_refresh_token' })
        await expect(
            freshAccessToken(
                linked,
                { github: app },
                store,
                9_999_000,
                fetchImpl
            )
        ).rejects.toThrow(/Reconnect/)
    })

    test('never refreshes a pasted token', async () => {
        const pat = account({ source: 'pat', expiresAt: 1 })
        expect(await freshAccessToken(pat, {}, store, 10)).toBe('token')
    })
})
