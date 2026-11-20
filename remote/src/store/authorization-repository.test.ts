import { randomBytes } from 'node:crypto'

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { Store } from './store'
import { CODE_TTL_MS, PENDING_TTL_MS } from './store.constants'
import {
    BROWSER_SECRET,
    openStoreOnDisk,
    removeStoresOnDisk,
    startConnection,
} from './store.fixtures'
import type { PendingAuthorization } from './store.types'

afterEach(removeStoresOnDisk)

const APP = { kind: 'gitlab', host: 'git.example.com' } as const

const REDIRECT = 'https://claude.ai/api/mcp/auth_callback?code=c'

let store: Store
let pending: PendingAuthorization

beforeEach(() => {
    store = new Store(':memory:', randomBytes(32))
    pending = startConnection(store, 1_000)
})

describe('pending authorizations', () => {
    test('are found with the browser secret that started them', () => {
        expect(
            store.authorizations.getPending('pending', BROWSER_SECRET, 1_000)
        ).toEqual(pending)
        expect(pending.scopes).toEqual([])
    })

    test('stay hidden without the browser secret', () => {
        expect(
            store.authorizations.getPending('pending', undefined, 1_000)
        ).toBeUndefined()
        expect(
            store.authorizations.getPending('pending', 'other', 1_000)
        ).toBeUndefined()
    })

    test('expire after the pending lifetime', () => {
        const lastValid = 1_000 + PENDING_TTL_MS
        expect(
            store.authorizations.getPending(
                'pending',
                BROWSER_SECRET,
                lastValid
            )
        ).toBeDefined()
        expect(
            store.authorizations.getPending(
                'pending',
                BROWSER_SECRET,
                lastValid + 1
            )
        ).toBeUndefined()
    })

    test('raise a clear error when stored scopes are corrupt', () => {
        const { db, store } = openStoreOnDisk()
        startConnection(store)
        db.query(`UPDATE pending SET scopes = '{"not":"a list"}'`).run()
        expect(() =>
            store.authorizations.getPending('pending', BROWSER_SECRET, 0)
        ).toThrow(/stored pending scopes/)
    })
})

describe('upstream login', () => {
    test('can be taken once', () => {
        store.authorizations.setUpstreamLogin(pending, 'state', 'verifier', APP)

        expect(
            store.authorizations.takeUpstreamLogin(
                'state',
                BROWSER_SECRET,
                1_000
            )
        ).toEqual({ pending, codeVerifier: 'verifier', ...APP })
        expect(
            store.authorizations.takeUpstreamLogin(
                'state',
                BROWSER_SECRET,
                1_000
            )
        ).toBeUndefined()
    })

    test('is not handed to another browser', () => {
        store.authorizations.setUpstreamLogin(pending, 'state', 'verifier', APP)
        expect(
            store.authorizations.takeUpstreamLogin('state', 'other', 1_000)
        ).toBeUndefined()
    })
})

describe('authorization codes', () => {
    beforeEach(() => {
        store.authorizations.completePending(pending, 'code', REDIRECT, 1_000)
    })

    test('keep the finished redirect on the page', () => {
        expect(
            store.authorizations.getPending('pending', BROWSER_SECRET, 1_000)
                ?.finishedRedirect
        ).toBe(REDIRECT)
    })

    test('can be peeked until they expire', () => {
        const expiresAt = 1_000 + CODE_TTL_MS
        expect(store.authorizations.peekCode('code', expiresAt)).toEqual({
            clientId: 'claude',
            codeChallenge: 'challenge',
            connectionId: pending.connectionId,
            expiresAt,
            redirectUri: pending.redirectUri,
            resource: null,
            scopes: [],
        })
        expect(
            store.authorizations.peekCode('code', expiresAt + 1)
        ).toBeUndefined()
    })

    test('are single-use', () => {
        expect(store.authorizations.takeCode('code', 1_000)).toBeDefined()
        expect(store.authorizations.takeCode('code', 1_000)).toBeUndefined()
        expect(store.authorizations.peekCode('code', 1_000)).toBeUndefined()
    })
})
