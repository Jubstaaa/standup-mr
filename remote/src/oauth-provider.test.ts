import { randomBytes } from 'node:crypto'

import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js'
import { beforeEach, describe, expect, test } from 'bun:test'
import type { Response } from 'express'

import { StandupOAuthProvider } from './oauth-provider'
import { Store } from './store'
import { CODE_TTL_MS } from './store.constants'

const client = {
    client_id: 'claude',
    redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
} as OAuthClientInformationFull

let now: number
let store: Store
let provider: StandupOAuthProvider

function fakeResponse() {
    const res = { location: '' }
    return {
        res,
        response: {
            redirect: (to: string) => {
                res.location = to
            },
        } as unknown as Response,
    }
}

async function connectAndFinish(): Promise<string> {
    const { res, response } = fakeResponse()
    await provider.authorize(
        client,
        {
            codeChallenge: 'challenge',
            redirectUri: client.redirect_uris[0]!,
            state: 'xyz',
        },
        response
    )
    const pendingId = res.location.replace('/connect/', '')
    const pending = store.getPending(pendingId, now)!
    store.completePending(pending, 'the-code', now + CODE_TTL_MS, now)
    return 'the-code'
}

beforeEach(() => {
    now = 1_000_000
    store = new Store(':memory:', randomBytes(32))
    provider = new StandupOAuthProvider(store, () => now)
    store.saveClient(client)
})

describe('authorization code', () => {
    test('exposes the PKCE challenge and exchanges once', async () => {
        const code = await connectAndFinish()
        expect(await provider.challengeForAuthorizationCode(client, code)).toBe(
            'challenge'
        )

        const tokens = await provider.exchangeAuthorizationCode(client, code)
        expect(tokens.access_token).toBeTruthy()
        expect(tokens.refresh_token).toBeTruthy()

        await expect(
            provider.exchangeAuthorizationCode(client, code)
        ).rejects.toThrow()
    })

    test('rejects an expired code', async () => {
        const code = await connectAndFinish()
        now += CODE_TTL_MS + 1
        await expect(
            provider.exchangeAuthorizationCode(client, code)
        ).rejects.toThrow()
    })

    test('rejects a code issued to another client', async () => {
        const code = await connectAndFinish()
        const other = { ...client, client_id: 'other' }
        await expect(
            provider.exchangeAuthorizationCode(other, code)
        ).rejects.toThrow()
    })
})

describe('access tokens', () => {
    test('verify carries the connection id', async () => {
        const tokens = await provider.exchangeAuthorizationCode(
            client,
            await connectAndFinish()
        )
        const info = await provider.verifyAccessToken(tokens.access_token)
        expect(info.extra?.connectionId).toBeTruthy()
    })

    test('a refresh token is not an access token', async () => {
        const tokens = await provider.exchangeAuthorizationCode(
            client,
            await connectAndFinish()
        )
        await expect(
            provider.verifyAccessToken(tokens.refresh_token!)
        ).rejects.toThrow()
    })

    test('expire after an hour', async () => {
        const tokens = await provider.exchangeAuthorizationCode(
            client,
            await connectAndFinish()
        )
        now += 60 * 60_000 + 1
        await expect(
            provider.verifyAccessToken(tokens.access_token)
        ).rejects.toThrow()
    })
})

describe('refresh rotation', () => {
    test('issues a new pair and retires the old refresh token', async () => {
        const first = await provider.exchangeAuthorizationCode(
            client,
            await connectAndFinish()
        )
        const second = await provider.exchangeRefreshToken(
            client,
            first.refresh_token!
        )
        expect(second.refresh_token).not.toBe(first.refresh_token)
        await provider.verifyAccessToken(second.access_token)
    })

    test('reuse of a rotated token revokes the whole family', async () => {
        const first = await provider.exchangeAuthorizationCode(
            client,
            await connectAndFinish()
        )
        const second = await provider.exchangeRefreshToken(
            client,
            first.refresh_token!
        )

        await expect(
            provider.exchangeRefreshToken(client, first.refresh_token!)
        ).rejects.toThrow(/reuse/)

        await expect(
            provider.verifyAccessToken(second.access_token)
        ).rejects.toThrow()
        await expect(
            provider.exchangeRefreshToken(client, second.refresh_token!)
        ).rejects.toThrow()
    })
})

describe('revocation', () => {
    test('deletes the connection with its accounts', async () => {
        const tokens = await provider.exchangeAuthorizationCode(
            client,
            await connectAndFinish()
        )
        const { extra } = await provider.verifyAccessToken(tokens.access_token)
        const connectionId = extra!.connectionId as string
        store.addAccount({
            connectionId,
            provider: 'github',
            host: 'github.com',
            username: 'ilker',
            source: 'pat',
            accessToken: 'ghp_x',
            refreshToken: null,
            expiresAt: null,
        })

        await provider.revokeToken(client, { token: tokens.refresh_token! })

        expect(store.listAccounts(connectionId)).toEqual([])
        await expect(
            provider.verifyAccessToken(tokens.access_token)
        ).rejects.toThrow()
    })
})

describe('store', () => {
    test('encrypts tokens at rest and reads them back', () => {
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
            now
        )
        store.addAccount({
            connectionId,
            provider: 'gitlab',
            host: 'git.example.com',
            username: 'ilker',
            source: 'pat',
            accessToken: 'glpat-secret',
            refreshToken: null,
            expiresAt: null,
        })
        expect(store.listAccounts(connectionId)[0]!.accessToken).toBe(
            'glpat-secret'
        )
    })

    test('relinking the same host replaces the account', () => {
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
            now
        )
        const base = {
            connectionId,
            provider: 'gitlab' as const,
            host: 'git.example.com',
            source: 'pat' as const,
            refreshToken: null,
            expiresAt: null,
        }
        store.addAccount({ ...base, username: 'a', accessToken: 'one' })
        store.addAccount({ ...base, username: 'b', accessToken: 'two' })
        const accounts = store.listAccounts(connectionId)
        expect(accounts).toHaveLength(1)
        expect(accounts[0]!.accessToken).toBe('two')
    })

    test('purge drops abandoned connect pages', () => {
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
            now
        )
        store.purge(now + 16 * 60_000)
        expect(store.getPending('pending', now)).toBeUndefined()
        expect(store.listAccounts(connectionId)).toEqual([])
    })
})
