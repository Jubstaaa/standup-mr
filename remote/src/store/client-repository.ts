import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js'
import type { Database } from 'bun:sqlite'
import { z } from 'zod'

import { parseStored } from './stored-json'

// Only the fields this server and the SDK's handlers read are checked; the
// rest passes through as the SDK wrote it. Validating with the SDK's own
// schema would make a minor SDK bump that tightens it reject every client
// already registered.
const storedClientSchema = z.looseObject({
    client_id: z.string(),
    client_name: z.string().optional(),
    client_secret: z.string().optional(),
    client_secret_expires_at: z.number().optional(),
    redirect_uris: z.array(z.string()),
    token_endpoint_auth_method: z.string().optional(),
})

// Clients registered through dynamic client registration.
export class ClientRepository {
    constructor(private readonly db: Database) {}

    get(id: string): OAuthClientInformationFull | undefined {
        const row = this.db
            .query<{ info: string }, [string]>(
                'SELECT info FROM clients WHERE id = ?'
            )
            .get(id)
        if (!row) return undefined
        // The loose schema checks what is read; the remaining fields are the
        // SDK's own output from registration.
        return parseStored(
            storedClientSchema,
            row.info,
            'client'
        ) as OAuthClientInformationFull
    }

    save(client: OAuthClientInformationFull, now: number): void {
        this.db
            .query(
                'INSERT OR REPLACE INTO clients (id, info, created_at) VALUES (?, ?, ?)'
            )
            .run(client.client_id, JSON.stringify(client), now)
    }
}
