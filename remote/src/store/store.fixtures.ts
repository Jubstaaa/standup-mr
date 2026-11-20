import { randomBytes } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Database } from 'bun:sqlite'

import { Store } from './store'
import type { PendingAuthorization } from './store.types'

export const BROWSER_SECRET = 'browser-secret'

export function startConnection(
    store: Store,
    now = 0,
    pendingId = 'pending'
): PendingAuthorization {
    return store.authorizations.createPending(
        {
            pendingId,
            browserSecret: BROWSER_SECRET,
            clientId: 'claude',
            codeChallenge: 'challenge',
            redirectUri: 'https://claude.ai/api/mcp/auth_callback',
            resource: null,
            scopes: [],
            state: 'xyz',
        },
        now
    )
}

// A second connection to the same file lets a test write rows the store
// itself never would, such as corrupt JSON.
export function openStoreOnDisk(): { db: Database; key: Buffer; store: Store } {
    const path = join(mkdtempSync(join(tmpdir(), 'standup-store-')), 'db')
    const key = randomBytes(32)
    const store = new Store(path, key)
    return { db: new Database(path, { strict: true }), key, store }
}
