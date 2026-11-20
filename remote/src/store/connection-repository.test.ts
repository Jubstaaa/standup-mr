import { randomBytes } from 'node:crypto'

import { describe, expect, test } from 'bun:test'

import { seal } from '../crypto/crypto'

import { Store } from './store'
import { openStoreOnDisk, startConnection } from './store.fixtures'
import type { Webhook } from './store.types'

const WEBHOOK: Webhook = {
    kind: 'slack',
    url: 'https://hooks.slack.com/services/T/B/X',
}

describe('ConnectionRepository', () => {
    test('sets, reads and clears the webhook', () => {
        const store = new Store(':memory:', randomBytes(32))
        const { connectionId } = startConnection(store)
        expect(store.connections.getWebhook(connectionId)).toBeUndefined()
        store.connections.setWebhook(connectionId, WEBHOOK)
        expect(store.connections.getWebhook(connectionId)).toEqual(WEBHOOK)
        store.connections.setWebhook(connectionId, undefined)
        expect(store.connections.getWebhook(connectionId)).toBeUndefined()
    })

    test('raises a clear error for a stored webhook of an unknown kind', () => {
        const { db, key, store } = openStoreOnDisk()
        const { connectionId } = startConnection(store)
        db.query('UPDATE connections SET webhook = ? WHERE id = ?').run(
            seal(key, JSON.stringify({ kind: 'teams', url: WEBHOOK.url })),
            connectionId
        )
        expect(() => store.connections.getWebhook(connectionId)).toThrow(
            /stored webhook/
        )
    })

    test('deleting a connection removes what belongs to it', () => {
        const store = new Store(':memory:', randomBytes(32))
        const { connectionId } = startConnection(store)
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
        store.connections.delete(connectionId)
        expect(store.accounts.list(connectionId)).toEqual([])
    })
})
