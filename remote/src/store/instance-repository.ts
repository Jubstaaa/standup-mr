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

    get(
        connectionId: string,
        kind: ProviderKind,
        host: string
    ): Instance | undefined {
        const row = this.db
            .query<InstanceRow, [string, string, string]>(
                'SELECT * FROM instances WHERE connection_id = ? AND kind = ? AND host = ?'
            )
            .get(connectionId, kind, host)
        if (!row) return undefined
        return {
            kind: row.kind,
            host: row.host,
            clientId: row.client_id,
            clientSecret: open(this.key, row.client_secret),
            verifiedAt: row.verified_at,
        }
    }

    // A connection may replace its own application while it is unproven.
    // The first successful sign-in locks it, so the tokens it issued can
    // still be refreshed.
    save(
        connectionId: string,
        instance: Omit<Instance, 'verifiedAt'>,
        now: number
    ): boolean {
        const result = this.db
            .query(
                `INSERT INTO instances (connection_id, kind, host, client_id, client_secret, created_at)
                 VALUES (?, ?, ?, ?, ?, ?)
                 ON CONFLICT (connection_id, kind, host) DO UPDATE SET
                 client_id = excluded.client_id, client_secret = excluded.client_secret,
                 created_at = excluded.created_at
                 WHERE instances.verified_at IS NULL`
            )
            .run(
                connectionId,
                instance.kind,
                instance.host,
                instance.clientId,
                seal(this.key, instance.clientSecret),
                now
            )
        return result.changes > 0
    }

    markVerified(
        connectionId: string,
        kind: ProviderKind,
        host: string,
        now: number
    ): void {
        this.db
            .query(
                `UPDATE instances SET verified_at = ?
                 WHERE connection_id = ? AND kind = ? AND host = ? AND verified_at IS NULL`
            )
            .run(now, connectionId, kind, host)
    }
}
