import { OAuthClientInformationFullSchema } from '@modelcontextprotocol/sdk/shared/auth.js'
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js'
import type { Database } from 'bun:sqlite'

import { parseStored } from './stored-json'

// Clients registered through dynamic client registration.
export class ClientRepository {
    constructor(private readonly db: Database) {}

    get(id: string): OAuthClientInformationFull | undefined {
        const row = this.db
            .query<{ info: string }, [string]>(
                'SELECT info FROM clients WHERE id = ?'
            )
            .get(id)
        return row
            ? parseStored(OAuthClientInformationFullSchema, row.info, 'client')
            : undefined
    }

    save(client: OAuthClientInformationFull, now: number): void {
        this.db
            .query(
                'INSERT OR REPLACE INTO clients (id, info, created_at) VALUES (?, ?, ?)'
            )
            .run(client.client_id, JSON.stringify(client), now)
    }
}
