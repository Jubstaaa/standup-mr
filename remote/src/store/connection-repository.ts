import type { Database } from 'bun:sqlite'
import { z } from 'zod'

import { WEBHOOK_KINDS } from '../../../src/notify/notify.constants'
import { open, seal } from '../crypto/crypto'

import type { Webhook } from './store.types'
import { parseStored } from './stored-json'

const webhookSchema = z.object({
    kind: z.enum(WEBHOOK_KINDS),
    url: z.string(),
})

// A connected MCP client and the settings that hang off it. The rows that
// belong to a connection are removed with it by ON DELETE CASCADE.
export class ConnectionRepository {
    constructor(
        private readonly db: Database,
        private readonly key: Buffer
    ) {}

    delete(connectionId: string): void {
        this.db.query('DELETE FROM connections WHERE id = ?').run(connectionId)
    }

    touch(connectionId: string, now: number): void {
        this.db
            .query('UPDATE connections SET last_used_at = ? WHERE id = ?')
            .run(now, connectionId)
    }

    getWebhook(connectionId: string): Webhook | undefined {
        const row = this.db
            .query<{ webhook: string | null }, [string]>(
                'SELECT webhook FROM connections WHERE id = ?'
            )
            .get(connectionId)
        return row?.webhook
            ? parseStored(webhookSchema, open(this.key, row.webhook), 'webhook')
            : undefined
    }

    setWebhook(connectionId: string, webhook: Webhook | undefined): void {
        this.db
            .query('UPDATE connections SET webhook = ? WHERE id = ?')
            .run(
                webhook ? seal(this.key, JSON.stringify(webhook)) : null,
                connectionId
            )
    }
}
