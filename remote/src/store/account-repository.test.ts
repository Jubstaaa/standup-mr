import { randomBytes } from 'node:crypto'

import { beforeEach, describe, expect, test } from 'bun:test'

import type { NewAccount } from '../accounts/accounts.types'

import { Store } from './store'
import { startConnection } from './store.fixtures'

let store: Store
let connectionId: string

beforeEach(() => {
    store = new Store(':memory:', randomBytes(32))
    connectionId = startConnection(store).connectionId
})

function account(overrides: Partial<NewAccount> = {}): NewAccount {
    return {
        connectionId,
        provider: 'github',
        host: 'github.com',
        username: 'ilker',
        source: 'oauth',
        accessToken: 'access',
        refreshToken: 'refresh',
        expiresAt: 100,
        ...overrides,
    }
}

describe('AccountRepository', () => {
    test('adds an account and lists it with its tokens', () => {
        const added = store.accounts.add(account())
        expect(store.accounts.list(connectionId)).toEqual([added])
        expect(added).toMatchObject({
            accessToken: 'access',
            refreshToken: 'refresh',
        })
    })

    test('replaces the account for the same host instead of adding one', () => {
        const first = store.accounts.add(account())
        const second = store.accounts.add(
            account({
                username: 'other',
                source: 'pat',
                accessToken: 'pat',
                refreshToken: null,
                expiresAt: null,
            })
        )

        expect(second.id).toBe(first.id)
        expect(store.accounts.list(connectionId)).toEqual([
            {
                ...first,
                username: 'other',
                source: 'pat',
                accessToken: 'pat',
                refreshToken: null,
                expiresAt: null,
            },
        ])
    })

    test('lists accounts by provider, then host', () => {
        store.accounts.add(account({ provider: 'gitlab', host: 'gitlab.com' }))
        store.accounts.add(account({ host: 'z.example.com' }))
        store.accounts.add(account())
        expect(
            store.accounts
                .list(connectionId)
                .map(a => `${a.provider}/${a.host}`)
        ).toEqual([
            'github/github.com',
            'github/z.example.com',
            'gitlab/gitlab.com',
        ])
    })

    test('keeps the refresh token when a refresh does not return one', () => {
        const { id } = store.accounts.add(account())
        store.accounts.updateTokens(id, {
            accessToken: 'new',
            refreshToken: null,
            expiresAt: 200,
        })
        expect(store.accounts.list(connectionId)[0]).toMatchObject({
            accessToken: 'new',
            refreshToken: 'refresh',
            expiresAt: 200,
        })
    })

    test('removes an account only from its own connection', () => {
        const { id } = store.accounts.add(account())
        store.accounts.remove('another-connection', id)
        expect(store.accounts.list(connectionId)).toHaveLength(1)
        store.accounts.remove(connectionId, id)
        expect(store.accounts.list(connectionId)).toEqual([])
    })
})
