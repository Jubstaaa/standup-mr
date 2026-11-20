import { randomBytes } from 'node:crypto'

import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js'
import { afterEach, describe, expect, test } from 'bun:test'

import { Store } from './store'
import { openStoreOnDisk, removeStoresOnDisk } from './store.fixtures'

afterEach(removeStoresOnDisk)

const CLIENT: OAuthClientInformationFull = {
    client_id: 'claude',
    client_id_issued_at: 1,
    client_name: 'Claude',
    redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
    token_endpoint_auth_method: 'none',
}

describe('ClientRepository', () => {
    test('reads back a saved client', () => {
        const store = new Store(':memory:', randomBytes(32))
        store.clients.save(CLIENT, 1)
        expect(store.clients.get('claude')).toEqual(CLIENT)
        expect(store.clients.get('unknown')).toBeUndefined()
    })

    test('reads a client whose extra metadata a newer SDK would reject', () => {
        const { db, store } = openStoreOnDisk()
        const stored = { ...CLIENT, client_uri: 'not a url', extra: true }
        db.query(
            'INSERT INTO clients (id, info, created_at) VALUES (?, ?, 1)'
        ).run('claude', JSON.stringify(stored))
        expect(store.clients.get('claude')).toEqual(stored)
    })

    test('raises a clear error for a stored client that is not valid', () => {
        const { db, store } = openStoreOnDisk()
        db.query(
            `INSERT INTO clients (id, info, created_at) VALUES ('bad', '{"client_id":1}', 1)`
        ).run()
        expect(() => store.clients.get('bad')).toThrow(/stored client/)
    })

    test('raises a clear error for a stored client that is not JSON', () => {
        const { db, store } = openStoreOnDisk()
        db.query(
            `INSERT INTO clients (id, info, created_at) VALUES ('bad', 'not json', 1)`
        ).run()
        expect(() => store.clients.get('bad')).toThrow(/stored client/)
    })
})
