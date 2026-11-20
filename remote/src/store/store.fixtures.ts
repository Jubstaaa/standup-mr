import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
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

interface StoreOnDisk {
    cleanup: () => void
    db: Database
    key: Buffer
    path: string
    store: Store
}

const opened: StoreOnDisk[] = []

// A second connection to the same file lets a test write rows the store
// itself never would, such as corrupt JSON.
export function openStoreOnDisk(): StoreOnDisk {
    const dir = mkdtempSync(join(tmpdir(), 'standup-store-'))
    const path = join(dir, 'db')
    const key = randomBytes(32)
    const store = new Store(path, key)
    const db = new Database(path, { strict: true })
    const cleanup = () => {
        db.close()
        store.close()
        rmSync(dir, { recursive: true, force: true })
    }
    const onDisk = { cleanup, db, key, path, store }
    opened.push(onDisk)
    return onDisk
}

// For afterEach: closes and deletes every store a test opened on disk.
export function removeStoresOnDisk(): void {
    for (const onDisk of opened.splice(0)) onDisk.cleanup()
}
