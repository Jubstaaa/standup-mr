import { randomBytes } from 'node:crypto'

import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js'
import { beforeEach, describe, expect, test } from 'bun:test'
import type { Response } from 'express'

import { Store } from '../store/store'
import { REFRESH_REUSE_GRACE_MS } from '../store/store.constants'
import { BROWSER_SECRET, startConnection } from '../store/store.fixtures'

import { StandupOAuthProvider } from './oauth'

const REDIRECT_URI = 'https://claude.ai/api/mcp/auth_callback'
const MCP_URL = new URL('https://standup.example.com/mcp')

const client = {
    client_id: 'claude',
    redirect_uris: [REDIRECT_URI],
} as OAuthClientInformationFull

let now: number
let store: Store
let provider: StandupOAuthProvider

function fakeResponse() {
    const sent = {
        location: '',
        cookies: {} as Record<string, string>,
        options: {} as Record<string, unknown>,
    }
    const response = {
        redirect: (to: string) => {
            sent.location = to
        },
        cookie: (name: string, value: string, options: object) => {
            sent.cookies[name] = value
            sent.options[name] = options
        },
    } as unknown as Response
    return { sent, response }
}

function finishedCode(): string {
    const pending = startConnection(store, now)
    store.authorizations.completePending(pending, 'the-code', REDIRECT_URI, now)
    return 'the-code'
}

async function tokensFor(code = finishedCode()) {
    return provider.exchangeAuthorizationCode(
        client,
        code,
        undefined,
        REDIRECT_URI
    )
}

beforeEach(() => {
    now = 1_000_000
    store = new Store(':memory:', randomBytes(32))
    provider = new StandupOAuthProvider(store, {
        mcpUrl: MCP_URL,
        now: () => now,
        siteUrl: new URL('/', MCP_URL),
    })
    store.clients.save(client, now)
})

describe('authorize', () => {
    test('binds the connect page to the browser through a cookie', async () => {
        const { sent, response } = fakeResponse()
        await provider.authorize(
            client,
            { codeChallenge: 'c', redirectUri: REDIRECT_URI },
            response
        )
        const pendingId = sent.location.replace('/connect/', '')
        const secret = sent.cookies['__Host-standup_connect']!

        expect(
            store.authorizations.getPending(pendingId, secret, now)
        ).toBeDefined()
        expect(
            store.authorizations.getPending(pendingId, undefined, now)
        ).toBeUndefined()
        expect(
            store.authorizations.getPending(pendingId, 'other', now)
        ).toBeUndefined()
    })

    // __Host- keeps a sibling subdomain from planting its own cookie and
    // walking the user into the attacker's sign-in.
    test('uses a __Host- cookie over https and a plain one over http', async () => {
        const secure = fakeResponse()
        await provider.authorize(
            client,
            { codeChallenge: 'c', redirectUri: REDIRECT_URI },
            secure.response
        )
        expect(secure.sent.options['__Host-standup_connect']).toMatchObject({
            secure: true,
            path: '/',
            httpOnly: true,
        })

        const local = fakeResponse()
        await new StandupOAuthProvider(store, {
            mcpUrl: new URL('http://localhost/mcp'),
            now: () => now,
            siteUrl: new URL('http://localhost/'),
        }).authorize(
            client,
            { codeChallenge: 'c', redirectUri: REDIRECT_URI },
            local.response
        )
        expect(Object.keys(local.sent.cookies)).toEqual(['standup_connect'])
    })

    test('refuses a token for another resource', async () => {
        const { response } = fakeResponse()
        await expect(
            provider.authorize(
                client,
                {
                    codeChallenge: 'c',
                    redirectUri: REDIRECT_URI,
                    resource: new URL('https://elsewhere.example.com/mcp'),
                },
                response
            )
        ).rejects.toThrow()
    })

    test('accepts its own resource with a trailing slash', async () => {
        const { sent, response } = fakeResponse()
        await provider.authorize(
            client,
            {
                codeChallenge: 'c',
                redirectUri: REDIRECT_URI,
                resource: new URL(`${MCP_URL.href}/`),
            },
            response
        )
        expect(sent.location).toStartWith('/connect/')
    })
})

describe('client registration', () => {
    const register = async (redirect: string) =>
        provider.clientsStore.registerClient!({
            client_id: 'new',
            redirect_uris: [redirect],
        } as OAuthClientInformationFull)

    test.each([
        'https://claude.ai/api/mcp/auth_callback',
        'http://localhost:33418/callback',
        'http://127.0.0.1:9000/cb',
        'http://[::1]:9000/cb',
        'cursor://anysphere.cursor-retrieval/oauth/callback',
    ])('accepts %s', async redirect => {
        await expect(register(redirect)).resolves.toBeDefined()
    })

    test.each(['http://attacker.example.com/cb', 'javascript:alert(1)'])(
        'refuses %s',
        async redirect => {
            await expect(register(redirect)).rejects.toThrow(/redirect/i)
            expect(store.clients.get('new')).toBeUndefined()
        }
    )
})

describe('authorization code', () => {
    test('exposes the PKCE challenge and exchanges once', async () => {
        const code = finishedCode()
        expect(await provider.challengeForAuthorizationCode(client, code)).toBe(
            'challenge'
        )
        const tokens = await tokensFor(code)
        expect(tokens.access_token).toBeTruthy()
        await expect(tokensFor(code)).rejects.toThrow()
    })

    test('requires the redirect_uri used at authorize', async () => {
        await expect(
            provider.exchangeAuthorizationCode(client, finishedCode())
        ).rejects.toThrow(/redirect_uri/)
    })

    test('rejects an expired code', async () => {
        const code = finishedCode()
        now += 60_001
        await expect(tokensFor(code)).rejects.toThrow()
    })

    test('rejects a code issued to another client', async () => {
        const other = { ...client, client_id: 'other' }
        await expect(
            provider.exchangeAuthorizationCode(
                other,
                finishedCode(),
                undefined,
                REDIRECT_URI
            )
        ).rejects.toThrow()
    })
})

describe('access tokens', () => {
    test('carry the connection id', async () => {
        const info = await provider.verifyAccessToken(
            (await tokensFor()).access_token
        )
        expect(info.extra?.connectionId).toBeTruthy()
    })

    test('a refresh token is not an access token', async () => {
        await expect(
            provider.verifyAccessToken((await tokensFor()).refresh_token!)
        ).rejects.toThrow()
    })

    test('expire after an hour', async () => {
        const tokens = await tokensFor()
        now += 60 * 60_000 + 1
        await expect(
            provider.verifyAccessToken(tokens.access_token)
        ).rejects.toThrow()
    })
})

describe('refresh rotation', () => {
    test('issues a new pair', async () => {
        const first = await tokensFor()
        const second = await provider.exchangeRefreshToken(
            client,
            first.refresh_token!
        )
        expect(second.refresh_token).not.toBe(first.refresh_token)
        await provider.verifyAccessToken(second.access_token)
    })

    test('lets a lost response be retried within the grace window', async () => {
        const first = await tokensFor()
        await provider.exchangeRefreshToken(client, first.refresh_token!)
        now += REFRESH_REUSE_GRACE_MS - 1
        const retried = await provider.exchangeRefreshToken(
            client,
            first.refresh_token!
        )
        await provider.verifyAccessToken(retried.access_token)
    })

    test('late reuse of a rotated token revokes the whole family', async () => {
        const first = await tokensFor()
        const second = await provider.exchangeRefreshToken(
            client,
            first.refresh_token!
        )
        now += REFRESH_REUSE_GRACE_MS + 1
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
        const tokens = await tokensFor()
        const { extra } = await provider.verifyAccessToken(tokens.access_token)
        const connectionId = extra!.connectionId as string
        store.accounts.add({
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

        expect(store.accounts.list(connectionId)).toEqual([])
        await expect(
            provider.verifyAccessToken(tokens.access_token)
        ).rejects.toThrow()
    })
})

describe('store', () => {
    test('encrypts tokens at rest and reads them back', () => {
        const { connectionId } = startConnection(store, now)
        store.accounts.add({
            connectionId,
            provider: 'gitlab',
            host: 'git.example.com',
            username: 'ilker',
            source: 'pat',
            accessToken: 'glpat-secret',
            refreshToken: null,
            expiresAt: null,
        })
        expect(store.accounts.list(connectionId)[0]!.accessToken).toBe(
            'glpat-secret'
        )
    })

    test('relinking the same host replaces the account', () => {
        const { connectionId } = startConnection(store, now)
        const base = {
            connectionId,
            provider: 'gitlab' as const,
            host: 'git.example.com',
            source: 'pat' as const,
            refreshToken: null,
            expiresAt: null,
        }
        store.accounts.add({ ...base, username: 'a', accessToken: 'one' })
        store.accounts.add({ ...base, username: 'b', accessToken: 'two' })
        const accounts = store.accounts.list(connectionId)
        expect(accounts).toHaveLength(1)
        expect(accounts[0]!.accessToken).toBe('two')
    })

    test('the upstream login is single-use and browser-bound', () => {
        const pending = startConnection(store, now)
        store.authorizations.setUpstreamLogin(pending, 'upstream', 'verifier', {
            kind: 'gitlab',
            host: 'git.example.com',
        })
        expect(
            store.authorizations.takeUpstreamLogin('upstream', 'other', now)
        ).toBeUndefined()

        store.authorizations.setUpstreamLogin(pending, 'upstream', 'verifier', {
            kind: 'gitlab',
            host: 'git.example.com',
        })
        const login = store.authorizations.takeUpstreamLogin(
            'upstream',
            BROWSER_SECRET,
            now
        )
        expect(login?.pending.id).toBe('pending')
        expect(login?.codeVerifier).toBe('verifier')
        expect(
            store.authorizations.takeUpstreamLogin(
                'upstream',
                BROWSER_SECRET,
                now
            )
        ).toBeUndefined()
    })

    test('purge drops abandoned pages and unredeemed connections', () => {
        const abandoned = startConnection(store, now, 'abandoned')
        const unredeemed = startConnection(store, now, 'unredeemed')
        store.authorizations.completePending(
            unredeemed,
            'never-used',
            REDIRECT_URI,
            now
        )
        for (const { connectionId } of [abandoned, unredeemed]) {
            store.accounts.add({
                connectionId,
                provider: 'github',
                host: 'github.com',
                username: 'ilker',
                source: 'pat',
                accessToken: 'ghp',
                refreshToken: null,
                expiresAt: null,
            })
        }

        store.purge(now + 16 * 60_000)

        expect(store.accounts.list(abandoned.connectionId)).toEqual([])
        expect(store.accounts.list(unredeemed.connectionId)).toEqual([])
    })

    test('purge drops registered clients nobody uses', () => {
        store.purge(now + 2 * 24 * 60 * 60_000)
        expect(store.clients.get('claude')).toBeUndefined()
    })
})
