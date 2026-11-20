import { randomBytes } from 'node:crypto'

import { beforeEach, describe, expect, test } from 'bun:test'

import { Store } from './store'
import { startConnection } from './store.fixtures'
import type { StoredToken } from './store.types'

let store: Store
let token: Omit<StoredToken, 'usedAt'>

beforeEach(() => {
    store = new Store(':memory:', randomBytes(32))
    token = {
        clientId: 'claude',
        connectionId: startConnection(store).connectionId,
        expiresAt: 100,
        family: 'family',
        kind: 'refresh',
        resource: null,
        scopes: ['read'],
    }
})

describe('TokenRepository', () => {
    test('finds a token by its value, never storing it in the clear', () => {
        store.tokens.save('secret', token)
        expect(store.tokens.get('secret')).toEqual({ ...token, usedAt: null })
        expect(store.tokens.get('other')).toBeUndefined()
    })

    test('records when a token was used', () => {
        store.tokens.save('secret', token)
        store.tokens.markUsed('secret', 7)
        expect(store.tokens.get('secret')?.usedAt).toBe(7)
    })

    test('revokes every token of a family', () => {
        store.tokens.save('a', token)
        store.tokens.save('b', { ...token, kind: 'access' })
        store.tokens.save('c', { ...token, family: 'other' })
        store.tokens.revokeFamily('family')
        expect(store.tokens.get('a')).toBeUndefined()
        expect(store.tokens.get('b')).toBeUndefined()
        expect(store.tokens.get('c')).toBeDefined()
    })
})
