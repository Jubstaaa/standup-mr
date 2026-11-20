import { randomBytes } from 'node:crypto'

import { beforeEach, describe, expect, spyOn, test } from 'bun:test'
import * as oauth from 'oauth4webapi'

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

function refused(error: string, status: number) {
    return new oauth.ResponseBodyError('refused', {
        cause: { error },
        response: new Response(null, { status }),
    })
}

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
        linked = store.accounts.add({
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
        const fresh = createTokenRefresher(upstream(), store.accounts)
        expect(await fresh(linked, 0)).toBe('old')
        expect(refreshCalls).toBe(0)
    })

    test('refreshes a token about to expire and stores the new one', async () => {
        const fresh = createTokenRefresher(upstream(), store.accounts)
        expect(await fresh(linked, 9_999_000)).toBe('new')
        const [stored] = store.accounts.list(linked.connectionId)
        expect(stored!.accessToken).toBe('new')
        expect(stored!.refreshToken).toBe('refresh-2')
    })

    test('spends a single-use refresh token once for concurrent calls', async () => {
        const fresh = createTokenRefresher(upstream(), store.accounts)
        const tokens = await Promise.all([
            fresh(linked, 9_999_000),
            fresh(linked, 9_999_000),
        ])
        expect(tokens).toEqual(['new', 'new'])
        expect(refreshCalls).toBe(1)
    })

    test('uses the stored token when a stale copy comes in after a refresh', async () => {
        const fresh = createTokenRefresher(upstream(), store.accounts)
        await fresh(linked, 9_999_000)

        expect(await fresh(linked, 9_999_000)).toBe('new')
        expect(refreshCalls).toBe(1)
    })

    test('refreshes with the latest stored refresh token', async () => {
        const spent: string[] = []
        const fresh = createTokenRefresher(
            {
                resolve: () => githubApp,
                refresh: async (_app, refreshToken) => {
                    spent.push(refreshToken)
                    return { accessToken: 'n', refreshToken: 'r', expiresAt: 0 }
                },
            },
            store.accounts
        )
        store.accounts.updateTokens(linked.id, {
            accessToken: 'rotated',
            refreshToken: 'refresh-2',
            expiresAt: 10_000_000,
        })
        await fresh(linked, 9_999_000)
        expect(spent).toEqual(['refresh-2'])
    })

    test('resolves the sign-in app of the account connection', async () => {
        const asked: string[] = []
        const fresh = createTokenRefresher(
            {
                resolve: (_kind, _host, connectionId) => {
                    asked.push(connectionId)
                    return githubApp
                },
                refresh: () => refreshResult(),
            },
            store.accounts
        )
        await fresh(linked, 9_999_000)
        expect(asked).toEqual([linked.connectionId])
    })

    test('asks for a reconnect when the refresh token is refused', async () => {
        refreshResult = async () => {
            throw refused('invalid_grant', 400)
        }
        const fresh = createTokenRefresher(upstream(), store.accounts)
        const error = await fresh(linked, 9_999_000).catch(
            (caught: unknown) => caught
        )
        expect(error).toBeInstanceOf(AccountError)
        expect(String(error)).toMatch(/Reconnect/)
    })

    test.each([
        ['invalid_request', 400],
        ['invalid_scope', 400],
    ])(
        'calls a %s refusal temporary, not a reason to reconnect',
        async (code, status) => {
            refreshResult = async () => {
                throw refused(code, status)
            }
            const logged = spyOn(console, 'error').mockImplementation(() => {})
            try {
                const fresh = createTokenRefresher(upstream(), store.accounts)
                const error = await fresh(linked, 9_999_000).catch(
                    (caught: unknown) => caught
                )
                expect(error).not.toBeInstanceOf(AccountError)
                expect(String(error)).toMatch(/try again/i)
            } finally {
                logged.mockRestore()
            }
        }
    )

    test('says the sign-in app was rejected instead of asking for a reconnect', async () => {
        refreshResult = async () => {
            throw refused('invalid_client', 401)
        }
        const logged = spyOn(console, 'error').mockImplementation(() => {})
        try {
            const fresh = createTokenRefresher(upstream(), store.accounts)
            const error = await fresh(linked, 9_999_000).catch(
                (caught: unknown) => caught
            )
            expect(error).not.toBeInstanceOf(AccountError)
            expect(String(error)).toMatch(/sign-in app/)
        } finally {
            logged.mockRestore()
        }
    })

    test('a renewal that cannot be saved asks for a reconnect, not a retry', async () => {
        refreshResult = async () => {
            store.accounts.remove(linked.connectionId, linked.id)
            return { accessToken: 'new', refreshToken: 'r2', expiresAt: 1 }
        }
        const logged = spyOn(console, 'error').mockImplementation(() => {})
        try {
            const fresh = createTokenRefresher(upstream(), store.accounts)
            const error = await fresh(linked, 9_999_000).catch(
                (caught: unknown) => caught
            )
            expect(error).toBeInstanceOf(AccountError)
            expect(String(error)).toMatch(/could not be saved/)
        } finally {
            logged.mockRestore()
        }
    })

    test('leaves a refresh another server is running to that server', async () => {
        let finish: (tokens: UpstreamTokens) => void = () => undefined
        refreshResult = () =>
            new Promise(resolve => {
                finish = resolve
            })
        // Two refreshers on one database stand in for two processes.
        const first = createTokenRefresher(upstream(), store.accounts)
        const second = createTokenRefresher(upstream(), store.accounts)

        const running = first(linked, 9_999_000)
        await Bun.sleep(0)
        await expect(second(linked, 9_999_000)).rejects.toThrow(/try again/i)
        expect(refreshCalls).toBe(1)

        finish({
            accessToken: 'new',
            refreshToken: 'r2',
            expiresAt: 38_800_000,
        })
        expect(await running).toBe('new')
        expect(await second(linked, 9_999_000)).toBe('new')
        expect(refreshCalls).toBe(1)
    })

    test('a failed refresh frees the account for the next try', async () => {
        refreshResult = async () => {
            throw new Error('ECONNRESET')
        }
        const logged = spyOn(console, 'error').mockImplementation(() => {})
        try {
            const fresh = createTokenRefresher(upstream(), store.accounts)
            await expect(fresh(linked, 9_999_000)).rejects.toThrow()
            refreshResult = async () => ({
                accessToken: 'new',
                refreshToken: 'r2',
                expiresAt: 38_800_000,
            })
            expect(await fresh(linked, 9_999_000)).toBe('new')
            expect(refreshCalls).toBe(2)
        } finally {
            logged.mockRestore()
        }
    })

    test('calls a network failure temporary, not a reason to reconnect', async () => {
        refreshResult = async () => {
            throw new Error('ECONNRESET')
        }
        const logged = spyOn(console, 'error').mockImplementation(() => {})
        try {
            const fresh = createTokenRefresher(upstream(), store.accounts)
            const error = await fresh(linked, 9_999_000).catch(
                (caught: unknown) => caught
            )
            expect(error).not.toBeInstanceOf(AccountError)
            expect(String(error)).toMatch(/try again/i)
        } finally {
            logged.mockRestore()
        }
    })

    test('refuses to refresh an account that was removed meanwhile', async () => {
        const fresh = createTokenRefresher(upstream(), store.accounts)
        store.accounts.remove(linked.connectionId, linked.id)
        await expect(fresh(linked, 9_999_000)).rejects.toThrow(AccountError)
        expect(refreshCalls).toBe(0)
    })

    test('logs why the refresh failed, without the refresh token', async () => {
        refreshResult = async () => {
            throw refused('bad_refresh_token', 401)
        }
        const logged = spyOn(console, 'error').mockImplementation(() => {})
        try {
            const fresh = createTokenRefresher(upstream(), store.accounts)
            await expect(fresh(linked, 9_999_000)).rejects.toThrow()
            const line = logged.mock.calls.flat().join(' ')
            expect(line).toMatch(/bad_refresh_token/)
            expect(line).toMatch(/github\.com/)
            expect(line).not.toMatch(/\brefresh\b(?!_token)/)
        } finally {
            logged.mockRestore()
        }
    })

    test('never refreshes a pasted token', async () => {
        const fresh = createTokenRefresher(noUpstream, store.accounts)
        const pat = account({ source: 'pat', expiresAt: 1 })
        expect(await fresh(pat, 10)).toBe('token')
    })
})
