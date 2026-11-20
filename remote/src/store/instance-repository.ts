import type { Database } from 'bun:sqlite'

import type { ProviderKind } from '../../../src/standup.types'
import { open, seal } from '../crypto/crypto'

import type { Instance } from './store.types'

interface InstanceRow {
    client_id: string
    client_secret: string
    host: string
    kind: ProviderKind
    verified_at: number | null
}

export class InstanceRepository {
    constructor(
        private readonly db: Database,
        private readonly key: Buffer
    ) {}

    get(kind: ProviderKind, host: string): Instance | undefined {
        const row = this.db
            .query<InstanceRow, [string, string]>(
                'SELECT * FROM instances WHERE kind = ? AND host = ?'
            )
            .get(kind, host)
        if (!row) return undefined
        return {
            kind: row.kind,
            host: row.host,
            clientId: row.client_id,
            clientSecret: open(this.key, row.client_secret),
            verifiedAt: row.verified_at,
        }
    }

    // Anyone may register an instance's OAuth application, and replace it
    // while it is unproven. The first successful sign-in locks it, so a
    // working setup cannot be swapped out from the page.
    save(instance: Omit<Instance, 'verifiedAt'>, now: number): boolean {
        const result = this.db
            .query(
                `INSERT INTO instances (kind, host, client_id, client_secret, created_at)
                 VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT (kind, host) DO UPDATE SET
                 client_id = excluded.client_id, client_secret = excluded.client_secret,
                 created_at = excluded.created_at
                 WHERE instances.verified_at IS NULL`
            )
            .run(
                instance.kind,
                instance.host,
                instance.clientId,
                seal(this.key, instance.clientSecret),
                now
            )
        return result.changes > 0
    }

    markVerified(kind: ProviderKind, host: string, now: number): void {
        this.db
            .query(
                'UPDATE instances SET verified_at = ? WHERE kind = ? AND host = ? AND verified_at IS NULL'
            )
            .run(now, kind, host)
    }
}
