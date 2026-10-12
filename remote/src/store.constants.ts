const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE

export const PENDING_TTL_MS = 15 * MINUTE
export const CODE_TTL_MS = MINUTE
export const ACCESS_TOKEN_TTL_MS = 60 * MINUTE
export const REFRESH_TOKEN_TTL_MS = 30 * DAY
export const REFRESH_REUSE_GRACE_MS = MINUTE
export const CONNECTION_IDLE_MS = 90 * DAY
export const CLIENT_IDLE_MS = DAY

export const SCHEMA = `
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

CREATE INDEX IF NOT EXISTS tokens_family ON tokens (family);
CREATE INDEX IF NOT EXISTS tokens_connection ON tokens (connection_id);
CREATE INDEX IF NOT EXISTS pending_upstream_state ON pending (upstream_state);
`
