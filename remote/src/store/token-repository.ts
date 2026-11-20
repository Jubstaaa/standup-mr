import type { Database } from 'bun:sqlite'

import { hashToken } from '../crypto/crypto'

import type { StoredToken } from './store.types'
import { parseStored, scopesSchema } from './stored-json'

interface TokenRow {
    client_id: string
    connection_id: string
    expires_at: number
    family: string
    kind: StoredToken['kind']
    resource: string | null
    scopes: string
    used_at: number | null
}

// Access and refresh tokens issued to MCP clients, kept only as hashes.
export class TokenRepository {
    constructor(private readonly db: Database) {}

    save(token: string, data: Omit<StoredToken, 'usedAt'>): void {
        this.db
            .query(
                `INSERT INTO tokens (id, kind, connection_id, client_id, family,
                 resource, scopes, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
                hashToken(token),
                data.kind,
                data.connectionId,
                data.clientId,
                data.family,
                data.resource,
                JSON.stringify(data.scopes),
                data.expiresAt
            )
    }

    get(token: string): StoredToken | undefined {
        const row = this.db
            .query<TokenRow, [string]>('SELECT * FROM tokens WHERE id = ?')
            .get(hashToken(token))
        if (!row) return undefined
        return {
            clientId: row.client_id,
            connectionId: row.connection_id,
            expiresAt: row.expires_at,
            family: row.family,
            kind: row.kind,
            resource: row.resource,
            scopes: parseStored(scopesSchema, row.scopes, 'token scopes'),
            usedAt: row.used_at,
        }
    }

    markUsed(token: string, now: number): void {
        this.db
            .query('UPDATE tokens SET used_at = ? WHERE id = ?')
            .run(now, hashToken(token))
    }

    revokeFamily(family: string): void {
        this.db.query('DELETE FROM tokens WHERE family = ?').run(family)
    }
}
