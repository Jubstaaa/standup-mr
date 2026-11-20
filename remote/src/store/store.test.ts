import { randomBytes } from 'node:crypto'

import { beforeEach, describe, expect, test } from 'bun:test'

import { MIGRATIONS } from './migrations'
import { Store } from './store'
import {
    CLIENT_IDLE_MS,
    PENDING_TTL_MS,
    REFRESH_TOKEN_TTL_MS,
    UNVERIFIED_INSTANCE_TTL_MS,
} from './store.constants'
import { openStoreOnDisk, startConnection } from './store.fixtures'

const REDIRECT = 'https://claude.ai/api/mcp/auth_callback'

let store: Store

beforeEach(() => {
    store = new Store(':memory:', randomBytes(32))
})

function linkAccount(connectionId: string) {
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

// A finished sign-in whose code was redeemed: a refresh token keeps it alive.
function activeConnection(now: number, id: string): string {
    const pending = startConnection(store, now, id)
    store.authorizations.completePending(pending, `${id}-code`, REDIRECT, now)
    store.tokens.save(`${id}-refresh`, {
        clientId: 'claude',
        connectionId: pending.connectionId,
        expiresAt: now + REFRESH_TOKEN_TTL_MS,
        family: id,
        kind: 'refresh',
        resource: null,
        scopes: [],
    })
    linkAccount(pending.connectionId)
    return pending.connectionId
}

describe('Store.purge', () => {
    test('keeps an active connection and everything it owns', () => {
        const connectionId = activeConnection(0, 'active')
        store.clients.save(
            { client_id: 'claude', redirect_uris: [REDIRECT] },
            0
        )
        store.purge(CLIENT_IDLE_MS + PENDING_TTL_MS + 1)
        expect(store.accounts.list(connectionId)).toHaveLength(1)
        expect(store.tokens.get('active-refresh')).toBeDefined()
        expect(store.clients.get('claude')).toBeDefined()
    })

    test('drops a page nobody finished, with its connection', () => {
        const { connectionId } = startConnection(store, 0, 'abandoned')
        linkAccount(connectionId)
        store.purge(PENDING_TTL_MS + 1)
        expect(store.accounts.list(connectionId)).toEqual([])
    })

    test('drops a finished connection whose code was never redeemed', () => {
        const pending = startConnection(store, 0, 'unredeemed')
        store.authorizations.completePending(pending, 'code', REDIRECT, 0)
        linkAccount(pending.connectionId)
        store.purge(PENDING_TTL_MS + 1)
        expect(store.accounts.list(pending.connectionId)).toEqual([])
        expect(store.authorizations.peekCode('code', 0)).toBeUndefined()
    })

    test('drops a connection idle past its lifetime', () => {
        const connectionId = activeConnection(0, 'idle')
        store.purge(REFRESH_TOKEN_TTL_MS + 1)
        expect(store.accounts.list(connectionId)).toEqual([])
    })

    test('drops expired tokens and codes', () => {
        activeConnection(0, 'active')
        const pending = startConnection(store, 0, 'other')
        store.authorizations.completePending(pending, 'code', REDIRECT, 0)
        store.purge(REFRESH_TOKEN_TTL_MS + 1)
        expect(store.tokens.get('active-refresh')).toBeUndefined()
        expect(store.authorizations.takeCode('code', 0)).toBeUndefined()
    })

    test('drops instances nobody signed in with, keeps verified ones', () => {
        const instance = { clientId: 'id', clientSecret: 'secret' }
        store.instances.save({ ...instance, kind: 'gitlab', host: 'a' }, 0)
        store.instances.save({ ...instance, kind: 'gitlab', host: 'b' }, 0)
        store.instances.markVerified('gitlab', 'b', 0)
        store.purge(UNVERIFIED_INSTANCE_TTL_MS + 1)
        expect(store.instances.get('gitlab', 'a')).toBeUndefined()
        expect(store.instances.get('gitlab', 'b')).toBeDefined()
    })

    test('drops registered clients nobody uses', () => {
        store.clients.save({ client_id: 'idle', redirect_uris: [REDIRECT] }, 0)
        store.purge(CLIENT_IDLE_MS + 1)
        expect(store.clients.get('idle')).toBeUndefined()
    })
})

describe('Store.ping', () => {
    test('passes on a database at the latest schema version', () => {
        expect(() => store.ping()).not.toThrow()
    })

    test('fails when the schema is behind the code', () => {
        const { db, store: onDisk } = openStoreOnDisk()
        db.exec(`PRAGMA user_version = ${MIGRATIONS.length - 1}`)
        expect(() => onDisk.ping()).toThrow(/schema version/)
    })

    test('fails once the database is closed', () => {
        store.close()
        expect(() => store.ping()).toThrow()
    })
})
