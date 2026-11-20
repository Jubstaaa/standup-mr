import { randomBytes } from 'node:crypto'

import { beforeEach, describe, expect, test } from 'bun:test'

import { Store } from './store'

const HOST = 'git.example.com'

let store: Store

beforeEach(() => {
    store = new Store(':memory:', randomBytes(32))
})

function register(clientId: string, now = 1): boolean {
    return store.instances.save(
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
        expect(store.instances.get('gitlab', HOST)).toEqual({
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
        expect(store.instances.get('gitlab', HOST)?.clientId).toBe('second')
    })

    test('refuses to replace a verified instance', () => {
        register('first')
        store.instances.markVerified('gitlab', HOST, 5)

        expect(register('second')).toBe(false)
        expect(store.instances.get('gitlab', HOST)).toMatchObject({
            clientId: 'first',
            verifiedAt: 5,
        })
    })

    test('keeps the first verification time', () => {
        register('first')
        store.instances.markVerified('gitlab', HOST, 5)
        store.instances.markVerified('gitlab', HOST, 9)
        expect(store.instances.get('gitlab', HOST)?.verifiedAt).toBe(5)
    })

    test('keeps kinds apart on the same host', () => {
        register('first')
        expect(store.instances.get('github', HOST)).toBeUndefined()
    })
})
