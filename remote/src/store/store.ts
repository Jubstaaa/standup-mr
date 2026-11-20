import { Database } from 'bun:sqlite'

import { AccountRepository } from './account-repository'
import { AuthorizationRepository } from './authorization-repository'
import { ClientRepository } from './client-repository'
import { ConnectionRepository } from './connection-repository'
import { InstanceRepository } from './instance-repository'
import { migrate, MIGRATIONS, schemaVersion } from './migrations'
import { ScheduleRepository } from './schedule-repository'
import {
    CLIENT_IDLE_MS,
    PENDING_TTL_MS,
    REFRESH_TOKEN_TTL_MS,
    UNVERIFIED_INSTANCE_TTL_MS,
} from './store.constants'
import { TokenRepository } from './token-repository'

const TABLES = [
    'accounts',
    'clients',
    'codes',
    'connections',
    'instances',
    'pending',
    'schedules',
    'tokens',
] as const

// Matches the refresh token: past it the client cannot get back in anyway.
const CONNECTION_IDLE_MS = REFRESH_TOKEN_TTL_MS

// Opens the database once and hands each repository the same handle, so
// work that spans tables (purge, cascades) stays on one connection.
export class Store {
    readonly accounts: AccountRepository
    readonly authorizations: AuthorizationRepository
    readonly clients: ClientRepository
    readonly connections: ConnectionRepository
    readonly instances: InstanceRepository
    readonly schedules: ScheduleRepository
    readonly tokens: TokenRepository
    private readonly db: Database

    constructor(path: string, key: Buffer) {
        this.db = new Database(path, { create: true, strict: true })
        // The old and the new container overlap during a deploy: wait for
        // the other one's write instead of failing with SQLITE_BUSY.
        this.db.exec('PRAGMA busy_timeout = 5000')
        this.db.exec('PRAGMA journal_mode = WAL')
        migrate(this.db, MIGRATIONS)
        this.db.exec('PRAGMA foreign_keys = ON')
        this.accounts = new AccountRepository(this.db, key)
        this.authorizations = new AuthorizationRepository(this.db, key)
        this.clients = new ClientRepository(this.db)
        this.connections = new ConnectionRepository(this.db, key)
        this.instances = new InstanceRepository(this.db, key)
        this.schedules = new ScheduleRepository(this.db)
        this.tokens = new TokenRepository(this.db)
    }

    // A real read for the health check. Only a schema older than this code
    // fails: after a rollback the previous release must still pass while
    // reading a database a newer one already migrated. Every table is read,
    // so a database missing one fails too.
    ping(): void {
        const version = schemaVersion(this.db)
        if (version < MIGRATIONS.length) {
            throw new Error(
                `Database schema version ${version} is behind ${MIGRATIONS.length}.`
            )
        }
        for (const table of TABLES) {
            this.db.query(`SELECT 1 FROM ${table} LIMIT 1`).get()
        }
    }

    purge(now: number): void {
        this.db.transaction(() => {
            this.db
                .query(
                    'DELETE FROM connections WHERE activated_at IS NULL AND created_at < ?'
                )
                .run(now - PENDING_TTL_MS)
            // Finished, but the code was never redeemed: nothing can use it.
            this.db
                .query(
                    `DELETE FROM connections WHERE activated_at < ?
                     AND id NOT IN (SELECT connection_id FROM tokens)`
                )
                .run(now - PENDING_TTL_MS)
            this.db
                .query(
                    'DELETE FROM connections WHERE activated_at IS NOT NULL AND last_used_at < ?'
                )
                .run(now - CONNECTION_IDLE_MS)
            this.db
                .query('DELETE FROM pending WHERE created_at < ?')
                .run(now - PENDING_TTL_MS)
            this.db.query('DELETE FROM codes WHERE expires_at < ?').run(now)
            this.db.query('DELETE FROM tokens WHERE expires_at < ?').run(now)
            this.db
                .query(
                    'DELETE FROM instances WHERE verified_at IS NULL AND created_at < ?'
                )
                .run(now - UNVERIFIED_INSTANCE_TTL_MS)
            // Dynamic registration is open, so clients nobody uses go too.
            this.db
                .query(
                    `DELETE FROM clients WHERE created_at < ? AND id NOT IN (
                     SELECT client_id FROM pending UNION SELECT client_id FROM codes
                     UNION SELECT client_id FROM tokens)`
                )
                .run(now - CLIENT_IDLE_MS)
        })()
    }

    close(): void {
        this.db.close()
    }
}
