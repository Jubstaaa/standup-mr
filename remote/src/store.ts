import { randomUUID } from 'node:crypto'

import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js'
import { Database } from 'bun:sqlite'

import { hashToken, open, seal } from './crypto'
import type {
    Account,
    AuthCode,
    NewAccount,
    PendingAuthorization,
    StoredToken,
    UpstreamTokens,
    Webhook,
} from './remote.types'
import { CONNECTION_IDLE_MS, PENDING_TTL_MS, SCHEMA } from './store.constants'

interface AccountRow {
    id: string
    access_token: string
    connection_id: string
    expires_at: number | null
    host: string
    provider: Account['provider']
    refresh_token: string | null
    source: Account['source']
    username: string
}

interface PendingRow {
    client_id: string
    code_challenge: string
    connection_id: string
    created_at: number
    redirect_uri: string
    resource: string | null
    scopes: string
    state: string | null
}

interface CodeRow {
    client_id: string
    code_challenge: string
    connection_id: string
    expires_at: number
    redirect_uri: string
    resource: string | null
    scopes: string
}

interface TokenRow {
    client_id: string
    connection_id: string
    expires_at: number
    family: string
    kind: StoredToken['kind']
    resource: string | null
    scopes: string
    used: number
}

export class Store {
    private readonly db: Database
    private readonly key: Buffer

    constructor(path: string, key: Buffer) {
        this.db = new Database(path, { create: true, strict: true })
        this.key = key
        this.db.exec('PRAGMA journal_mode = WAL')
        this.db.exec('PRAGMA foreign_keys = ON')
        this.db.exec(SCHEMA)
    }

    getClient(id: string): OAuthClientInformationFull | undefined {
        const row = this.db
            .query<{ info: string }, [string]>(
                'SELECT info FROM clients WHERE id = ?'
            )
            .get(id)
        return row
            ? (JSON.parse(row.info) as OAuthClientInformationFull)
            : undefined
    }

    saveClient(client: OAuthClientInformationFull): void {
        this.db
            .query('INSERT OR REPLACE INTO clients (id, info) VALUES (?, ?)')
            .run(client.client_id, JSON.stringify(client))
    }

    // The pending id is the only thing guarding the connect page, so it is
    // stored hashed, like every other bearer value.
    createPending(
        input: Omit<PendingAuthorization, 'id' | 'connectionId' | 'createdAt'>,
        pendingId: string,
        now: number
    ): PendingAuthorization {
        const connectionId = randomUUID()
        this.db.transaction(() => {
            this.db
                .query(
                    'INSERT INTO connections (id, created_at, last_used_at) VALUES (?, ?, ?)'
                )
                .run(connectionId, now, now)
            this.db
                .query(
                    `INSERT INTO pending (id, connection_id, client_id, code_challenge,
                     redirect_uri, resource, scopes, state, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
                )
                .run(
                    hashToken(pendingId),
                    connectionId,
                    input.clientId,
                    input.codeChallenge,
                    input.redirectUri,
                    input.resource,
                    JSON.stringify(input.scopes),
                    input.state,
                    now
                )
        })()
        return { ...input, id: pendingId, connectionId, createdAt: now }
    }

    getPending(
        pendingId: string,
        now: number
    ): PendingAuthorization | undefined {
        const row = this.db
            .query<PendingRow, [string]>('SELECT * FROM pending WHERE id = ?')
            .get(hashToken(pendingId))
        if (!row || row.created_at + PENDING_TTL_MS < now) return undefined
        return {
            id: pendingId,
            clientId: row.client_id,
            codeChallenge: row.code_challenge,
            connectionId: row.connection_id,
            createdAt: row.created_at,
            redirectUri: row.redirect_uri,
            resource: row.resource,
            scopes: JSON.parse(row.scopes) as string[],
            state: row.state,
        }
    }

    // Turns a finished connect page into a single-use code. The pending row
    // goes in the same transaction, so the page cannot issue a second code.
    completePending(
        pending: PendingAuthorization,
        code: string,
        expiresAt: number,
        now: number
    ): void {
        this.db.transaction(() => {
            this.db
                .query('DELETE FROM pending WHERE id = ?')
                .run(hashToken(pending.id))
            this.db
                .query(
                    'UPDATE connections SET activated_at = ?, last_used_at = ? WHERE id = ?'
                )
                .run(now, now, pending.connectionId)
            this.db
                .query(
                    `INSERT INTO codes (id, connection_id, client_id, code_challenge,
                     redirect_uri, resource, scopes, expires_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
                )
                .run(
                    hashToken(code),
                    pending.connectionId,
                    pending.clientId,
                    pending.codeChallenge,
                    pending.redirectUri,
                    pending.resource,
                    JSON.stringify(pending.scopes),
                    expiresAt
                )
        })()
    }

    peekCode(code: string, now: number): AuthCode | undefined {
        const row = this.db
            .query<CodeRow, [string]>('SELECT * FROM codes WHERE id = ?')
            .get(hashToken(code))
        if (!row || row.expires_at < now) return undefined
        return {
            clientId: row.client_id,
            codeChallenge: row.code_challenge,
            connectionId: row.connection_id,
            expiresAt: row.expires_at,
            redirectUri: row.redirect_uri,
            resource: row.resource,
            scopes: JSON.parse(row.scopes) as string[],
        }
    }

    takeCode(code: string, now: number): AuthCode | undefined {
        const found = this.peekCode(code, now)
        this.db.query('DELETE FROM codes WHERE id = ?').run(hashToken(code))
        return found
    }

    saveToken(token: string, data: Omit<StoredToken, 'used'>): void {
        this.db
            .query(
                `INSERT INTO tokens (id, kind, connection_id, client_id, family,
                 resource, scopes, expires_at, used) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`
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

    getToken(token: string): StoredToken | undefined {
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
            scopes: JSON.parse(row.scopes) as string[],
            used: row.used === 1,
        }
    }

    markTokenUsed(token: string): void {
        this.db
            .query('UPDATE tokens SET used = 1 WHERE id = ?')
            .run(hashToken(token))
    }

    revokeFamily(family: string): void {
        this.db.query('DELETE FROM tokens WHERE family = ?').run(family)
    }

    deleteConnection(connectionId: string): void {
        this.db.query('DELETE FROM connections WHERE id = ?').run(connectionId)
    }

    touchConnection(connectionId: string, now: number): void {
        this.db
            .query('UPDATE connections SET last_used_at = ? WHERE id = ?')
            .run(now, connectionId)
    }

    addAccount(account: NewAccount): Account {
        const id = randomUUID()
        // Linking the same host twice replaces the old account rather than
        // leaving two that would make every tool call ambiguous.
        this.db
            .query(
                `INSERT INTO accounts (id, connection_id, provider, host, username, source,
                 access_token, refresh_token, expires_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT (connection_id, provider, host) DO UPDATE SET
                 username = excluded.username, source = excluded.source,
                 access_token = excluded.access_token,
                 refresh_token = excluded.refresh_token, expires_at = excluded.expires_at`
            )
            .run(
                id,
                account.connectionId,
                account.provider,
                account.host,
                account.username,
                account.source,
                seal(this.key, account.accessToken),
                account.refreshToken
                    ? seal(this.key, account.refreshToken)
                    : null,
                account.expiresAt
            )
        return this.listAccounts(account.connectionId).find(
            a => a.provider === account.provider && a.host === account.host
        )!
    }

    listAccounts(connectionId: string): Account[] {
        return this.db
            .query<AccountRow, [string]>(
                'SELECT * FROM accounts WHERE connection_id = ? ORDER BY provider, host'
            )
            .all(connectionId)
            .map(row => ({
                id: row.id,
                accessToken: open(this.key, row.access_token),
                connectionId: row.connection_id,
                expiresAt: row.expires_at,
                host: row.host,
                provider: row.provider,
                refreshToken: row.refresh_token
                    ? open(this.key, row.refresh_token)
                    : null,
                source: row.source,
                username: row.username,
            }))
    }

    removeAccount(connectionId: string, accountId: string): void {
        this.db
            .query('DELETE FROM accounts WHERE connection_id = ? AND id = ?')
            .run(connectionId, accountId)
    }

    updateAccountTokens(accountId: string, tokens: UpstreamTokens): void {
        this.db
            .query(
                `UPDATE accounts SET access_token = ?,
                 refresh_token = COALESCE(?, refresh_token), expires_at = ? WHERE id = ?`
            )
            .run(
                seal(this.key, tokens.accessToken),
                tokens.refreshToken
                    ? seal(this.key, tokens.refreshToken)
                    : null,
                tokens.expiresAt,
                accountId
            )
    }

    getWebhook(connectionId: string): Webhook | undefined {
        const row = this.db
            .query<{ webhook: string | null }, [string]>(
                'SELECT webhook FROM connections WHERE id = ?'
            )
            .get(connectionId)
        return row?.webhook
            ? (JSON.parse(open(this.key, row.webhook)) as Webhook)
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

    purge(now: number): void {
        this.db.transaction(() => {
            this.db
                .query(
                    'DELETE FROM connections WHERE activated_at IS NULL AND created_at < ?'
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
        })()
    }

    close(): void {
        this.db.close()
    }
}
