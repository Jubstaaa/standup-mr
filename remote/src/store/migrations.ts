import type { Database } from 'bun:sqlite'

// Each entry runs once, in order, and leaves PRAGMA user_version at its
// position in the list. Never edit an entry that has shipped: append one.
// A migration is SQL, or a function when it has something to report.
export type Migration = string | ((db: Database) => void)

export const MIGRATIONS: readonly Migration[] = [
    // The schema every release used before versioning existed. It keeps
    // IF NOT EXISTS so it is a no-op on those databases, still at version 0.
    `
CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY,
    info TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS connections (
    id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    activated_at INTEGER,
    last_used_at INTEGER NOT NULL,
    webhook TEXT
);

CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    host TEXT NOT NULL,
    username TEXT NOT NULL,
    source TEXT NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    expires_at INTEGER,
    UNIQUE (connection_id, provider, host)
);

CREATE TABLE IF NOT EXISTS pending (
    id TEXT PRIMARY KEY,
    browser_hash TEXT NOT NULL,
    upstream_state TEXT,
    upstream_return TEXT,
    finished_redirect TEXT,
    connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    client_id TEXT NOT NULL,
    code_challenge TEXT NOT NULL,
    redirect_uri TEXT NOT NULL,
    resource TEXT,
    scopes TEXT NOT NULL,
    state TEXT,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS codes (
    id TEXT PRIMARY KEY,
    connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    client_id TEXT NOT NULL,
    code_challenge TEXT NOT NULL,
    redirect_uri TEXT NOT NULL,
    resource TEXT,
    scopes TEXT NOT NULL,
    expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tokens (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    client_id TEXT NOT NULL,
    family TEXT NOT NULL,
    resource TEXT,
    scopes TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at INTEGER
);

CREATE TABLE IF NOT EXISTS instances (
    kind TEXT NOT NULL,
    host TEXT NOT NULL,
    client_id TEXT NOT NULL,
    client_secret TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    verified_at INTEGER,
    PRIMARY KEY (kind, host)
);

CREATE TABLE IF NOT EXISTS schedules (
    connection_id TEXT PRIMARY KEY REFERENCES connections(id) ON DELETE CASCADE,
    time TEXT NOT NULL,
    timezone TEXT NOT NULL,
    days TEXT NOT NULL,
    next_run_at INTEGER NOT NULL,
    last_sent_at INTEGER,
    last_error TEXT
);

CREATE INDEX IF NOT EXISTS tokens_family ON tokens (family);
CREATE INDEX IF NOT EXISTS tokens_connection ON tokens (connection_id);
CREATE INDEX IF NOT EXISTS pending_upstream_state ON pending (upstream_state);
CREATE INDEX IF NOT EXISTS schedules_next_run ON schedules (next_run_at);
`,
    // A self-hosted OAuth application belongs to the connection that
    // registered it; one shared per host let anyone lock it or harvest the
    // tokens of everyone signing in through it. Who registered a shared
    // row was never stored, so each one goes to every connection whose
    // OAuth account was issued by it (they need it to refresh); one nobody
    // signed in with is dropped and set up again by whoever needs it.
    db => {
        const dropped = db
            .query<{ n: number }, []>(
                `SELECT COUNT(*) AS n FROM instances WHERE NOT EXISTS (
                 SELECT 1 FROM accounts WHERE accounts.provider = instances.kind
                 AND accounts.host = instances.host AND accounts.source = 'oauth')`
            )
            .get()!.n
        db.exec(SCOPE_INSTANCES_TO_CONNECTIONS)
        if (dropped > 0) {
            console.error(
                `schema migration 2: dropped ${dropped} self-hosted OAuth app(s) nobody had signed in with; they are set up again on the connect page`
            )
        }
    },
]

const SCOPE_INSTANCES_TO_CONNECTIONS = `
CREATE TABLE instances_by_connection (
    connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    host TEXT NOT NULL,
    client_id TEXT NOT NULL,
    client_secret TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    verified_at INTEGER,
    PRIMARY KEY (connection_id, kind, host)
);

INSERT INTO instances_by_connection
SELECT DISTINCT accounts.connection_id, instances.kind, instances.host,
    instances.client_id, instances.client_secret, instances.created_at,
    instances.verified_at
FROM instances
JOIN accounts ON accounts.provider = instances.kind
    AND accounts.host = instances.host AND accounts.source = 'oauth';

DROP TABLE instances;
ALTER TABLE instances_by_connection RENAME TO instances;
`

export function schemaVersion(db: Database): number {
    const row = db
        .query<{ user_version: number }, []>('PRAGMA user_version')
        .get()
    return row?.user_version ?? 0
}

// About fifteen lines of user_version bookkeeping; the bun:sqlite migration
// packages are unmaintained (last release 2023) and umzug needs a custom
// storage adapter for user_version plus five dependencies.
//
// SQLite ignores PRAGMA foreign_keys inside a transaction, so it is switched
// off around it: a migration that rebuilds a parent table (create, copy,
// drop, rename) would otherwise cascade-delete every row that references
// it. foreign_key_check then proves the rebuild left no dangling reference.
// The transaction is IMMEDIATE because the old and the new container
// overlap during a deploy and both open the database.
export function migrate(db: Database, migrations: readonly Migration[]): void {
    const enforced = foreignKeysEnabled(db)
    db.exec('PRAGMA foreign_keys = OFF')
    try {
        db.transaction(() => {
            const current = schemaVersion(db)
            const pending = migrations.slice(current)
            pending.forEach((migration, offset) => {
                const version = current + offset + 1
                try {
                    if (typeof migration === 'string') db.exec(migration)
                    else migration(db)
                } catch (cause) {
                    throw new MigrationError(
                        `Schema migration ${version} failed`,
                        { cause }
                    )
                }
                db.exec(`PRAGMA user_version = ${version}`)
            })
            if (pending.length > 0) assertNoDanglingReferences(db)
        }).immediate()
    } catch (error) {
        if (error instanceof MigrationError) throw error
        // BEGIN IMMEDIATE itself failed: another process holds the lock.
        throw new Error('Could not lock the database to migrate it', {
            cause: error,
        })
    } finally {
        if (enforced) db.exec('PRAGMA foreign_keys = ON')
    }
}

class MigrationError extends Error {}

interface ForeignKeyViolation {
    parent: string
    rowid: number
    table: string
}

function assertNoDanglingReferences(db: Database): void {
    const dangling = db
        .query<ForeignKeyViolation, []>('PRAGMA foreign_key_check')
        .all()
    if (dangling.length === 0) return
    const shown = dangling
        .slice(0, 10)
        .map(row => `${row.table} row ${row.rowid} -> ${row.parent}`)
        .join(', ')
    throw new MigrationError(
        `Schema migration left ${dangling.length} rows with a broken foreign key: ${shown}`
    )
}

function foreignKeysEnabled(db: Database): boolean {
    const row = db
        .query<{ foreign_keys: number }, []>('PRAGMA foreign_keys')
        .get()
    return row?.foreign_keys === 1
}
