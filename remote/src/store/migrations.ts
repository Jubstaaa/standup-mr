import type { Database } from 'bun:sqlite'

// Each entry runs once, in order, and leaves PRAGMA user_version at its
// position in the list. Never edit an entry that has shipped: append one.
export const MIGRATIONS: readonly string[] = [
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
]

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
export function migrate(db: Database, migrations: readonly string[]): void {
    const enforced = foreignKeysEnabled(db)
    db.exec('PRAGMA foreign_keys = OFF')
    try {
        db.transaction(() => {
            const current = schemaVersion(db)
            migrations.slice(current).forEach((sql, offset) => {
                const version = current + offset + 1
                try {
                    db.exec(sql)
                } catch (cause) {
                    throw new Error(`Schema migration ${version} failed`, {
                        cause,
                    })
                }
                db.exec(`PRAGMA user_version = ${version}`)
            })
            const dangling = db.query('PRAGMA foreign_key_check').all()
            if (dangling.length > 0) {
                throw new Error(
                    `Schema migration left ${dangling.length} rows with a broken foreign key`
                )
            }
        }).immediate()
    } finally {
        if (enforced) db.exec('PRAGMA foreign_keys = ON')
    }
}

function foreignKeysEnabled(db: Database): boolean {
    const row = db
        .query<{ foreign_keys: number }, []>('PRAGMA foreign_keys')
        .get()
    return row?.foreign_keys === 1
}
