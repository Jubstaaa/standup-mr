import { randomBytes } from 'node:crypto'

import { beforeEach, describe, expect, test } from 'bun:test'

import { Store } from './store'
import { startConnection } from './store.fixtures'

const HOST = 'git.example.com'

let store: Store
let mine: string
let theirs: string

beforeEach(() => {
    store = new Store(':memory:', randomBytes(32))
    mine = startConnection(store, 0, 'mine').connectionId
    theirs = startConnection(store, 0, 'theirs').connectionId
})

function register(clientId: string, connectionId = mine, now = 1): boolean {
    return store.instances.save(
        connectionId,
        {
            kind: 'gitlab',
            host: HOST,
            clientId,
            clientSecret: `${clientId}-secret`,
        },
        now
    )
}

describe('InstanceRepository', () => {
    test('stores the client secret and reads it back', () => {
        expect(register('first')).toBe(true)
        expect(store.instances.get(mine, 'gitlab', HOST)).toEqual({
            kind: 'gitlab',
            host: HOST,
            clientId: 'first',
            clientSecret: 'first-secret',
            verifiedAt: null,
        })
    })

    test('lets an unverified instance be replaced', () => {
        register('first')
        expect(register('second')).toBe(true)
        expect(store.instances.get(mine, 'gitlab', HOST)?.clientId).toBe(
            'second'
        )
    })

    test('refuses to replace a verified instance', () => {
        register('first')
        store.instances.markVerified(mine, 'gitlab', HOST, 5)

        expect(register('second')).toBe(false)
        expect(store.instances.get(mine, 'gitlab', HOST)).toMatchObject({
            clientId: 'first',
            verifiedAt: 5,
        })
    })

    test('keeps the first verification time', () => {
        register('first')
        store.instances.markVerified(mine, 'gitlab', HOST, 5)
        store.instances.markVerified(mine, 'gitlab', HOST, 9)
        expect(store.instances.get(mine, 'gitlab', HOST)?.verifiedAt).toBe(5)
    })

    test('keeps kinds apart on the same host', () => {
        register('first')
        expect(store.instances.get(mine, 'github', HOST)).toBeUndefined()
    })

    test('is invisible to, and cannot be locked by, another connection', () => {
        register('first')
        expect(store.instances.get(theirs, 'gitlab', HOST)).toBeUndefined()

        store.instances.markVerified(theirs, 'gitlab', HOST, 5)
        expect(register('second')).toBe(true)

        expect(register('own', theirs)).toBe(true)
        expect(store.instances.get(mine, 'gitlab', HOST)?.clientId).toBe(
            'second'
        )
        expect(store.instances.get(theirs, 'gitlab', HOST)?.clientId).toBe(
            'own'
        )
    })

    test('goes with the connection that registered it', () => {
        register('first')
        store.connections.delete(mine)
        expect(store.instances.get(mine, 'gitlab', HOST)).toBeUndefined()
    })
})
