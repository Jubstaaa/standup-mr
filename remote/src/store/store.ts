import { randomUUID } from 'node:crypto'

import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js'
import { Database } from 'bun:sqlite'

import type { ProviderKind } from '../../../src/types/standup.types'
import type { Account, NewAccount } from '../accounts/accounts.types'
import { hashToken, open, seal } from '../crypto/crypto'
import type { UpstreamTokens } from '../upstream/upstream.types'

import {
    CLIENT_IDLE_MS,
    CODE_TTL_MS,
    CONNECTION_IDLE_MS,
    PENDING_TTL_MS,
    SCHEMA,
    UNVERIFIED_INSTANCE_TTL_MS,
} from './store.constants'
import type {
    AuthCode,
    Instance,
    NewPending,
    PendingAuthorization,
    Schedule,
    ScheduleSettings,
    StoredToken,
    UpstreamLogin,
    Webhook,
} from './store.types'

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
    browser_hash: string
    client_id: string
    code_challenge: string
    connection_id: string
    created_at: number
    finished_redirect: string | null
    redirect_uri: string
    resource: string | null
    scopes: string
    state: string | null
    upstream_return: string | null
}

interface InstanceRow {
    client_id: string
    client_secret: string
    host: string
    kind: ProviderKind
    verified_at: number | null
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
    used_at: number | null
}

interface ScheduleRow {
    connection_id: string
    days: string
    last_error: string | null
    last_sent_at: number | null
    next_run_at: number
    time: string
    timezone: string
}

function toSchedule(row: ScheduleRow): Schedule {
    return {
        connectionId: row.connection_id,
        days: row.days,
        lastError: row.last_error,
        lastSentAt: row.last_sent_at,
        nextRunAt: row.next_run_at,
        time: row.time,
        timezone: row.timezone,
    }
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

    saveClient(client: OAuthClientInformationFull, now: number): void {
        this.db
            .query(
                'INSERT OR REPLACE INTO clients (id, info, created_at) VALUES (?, ?, ?)'
            )
            .run(client.client_id, JSON.stringify(client), now)
    }

    // The pending id travels in URLs, so on its own it would let anyone
    // holding a link finish someone else's authorization. Every lookup also
    // needs the secret from the cookie set on the browser that started it.
    createPending(input: NewPending, now: number): PendingAuthorization {
        const connectionId = randomUUID()
        this.db.transaction(() => {
            this.db
                .query(
                    'INSERT INTO connections (id, created_at, last_used_at) VALUES (?, ?, ?)'
                )
                .run(connectionId, now, now)
            this.db
                .query(
                    `INSERT INTO pending (id, browser_hash, connection_id, client_id,
                     code_challenge, redirect_uri, resource, scopes, state, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                )
                .run(
                    hashToken(input.pendingId),
                    hashToken(input.browserSecret),
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
        return this.getPending(input.pendingId, input.browserSecret, now)!
    }

    getPending(
        pendingId: string,
        browserSecret: string | undefined,
        now: number
    ): PendingAuthorization | undefined {
        const row = this.db
            .query<PendingRow, [string]>('SELECT * FROM pending WHERE id = ?')
            .get(hashToken(pendingId))
        return this.toPending(pendingId, row, browserSecret, now)
    }

    // The callback only gets `state` back, so the page id it returns to and
    // the PKCE verifier for the upstream login are kept beside it, sealed.
    setUpstreamLogin(
        pending: PendingAuthorization,
        state: string,
        codeVerifier: string
    ): void {
        const login = JSON.stringify({ pendingId: pending.id, codeVerifier })
        this.db
            .query(
                'UPDATE pending SET upstream_state = ?, upstream_return = ? WHERE id = ?'
            )
            .run(hashToken(state), seal(this.key, login), hashToken(pending.id))
    }

    // The upstream state is single-use: it is cleared as soon as it is read.
    takeUpstreamLogin(
        state: string,
        browserSecret: string | undefined,
        now: number
    ): UpstreamLogin | undefined {
        const row = this.db
            .query<PendingRow & { id: string }, [string]>(
                'SELECT * FROM pending WHERE upstream_state = ?'
            )
            .get(hashToken(state))
        if (!row?.upstream_return) return undefined
        this.db
            .query(
                'UPDATE pending SET upstream_state = NULL, upstream_return = NULL WHERE id = ?'
            )
            .run(row.id)
        const login = JSON.parse(open(this.key, row.upstream_return)) as {
            codeVerifier: string
            pendingId: string
        }
        const pending = this.toPending(login.pendingId, row, browserSecret, now)
        return pending
            ? { pending, codeVerifier: login.codeVerifier }
            : undefined
    }

    getInstance(kind: ProviderKind, host: string): Instance | undefined {
        const row = this.db
            .query<InstanceRow, [string, string]>(
                'SELECT * FROM instances WHERE kind = ? AND host = ?'
            )
            .get(kind, host)
        if (!row) return undefined
        return {
            kind: row.kind,
            host: row.host,
            clientId: row.client_id,
            clientSecret: open(this.key, row.client_secret),
            verifiedAt: row.verified_at,
        }
    }

    // Anyone may register an instance's OAuth application, and replace it
    // while it is unproven. The first successful sign-in locks it, so a
    // working setup cannot be swapped out from the page.
    saveInstance(instance: Omit<Instance, 'verifiedAt'>, now: number): boolean {
        const result = this.db
            .query(
                `INSERT INTO instances (kind, host, client_id, client_secret, created_at)
                 VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT (kind, host) DO UPDATE SET
                 client_id = excluded.client_id, client_secret = excluded.client_secret,
                 created_at = excluded.created_at
                 WHERE instances.verified_at IS NULL`
            )
            .run(
                instance.kind,
                instance.host,
                instance.clientId,
                seal(this.key, instance.clientSecret),
                now
            )
        return result.changes > 0
    }

    markInstanceVerified(kind: ProviderKind, host: string, now: number): void {
        this.db
            .query(
                'UPDATE instances SET verified_at = ? WHERE kind = ? AND host = ? AND verified_at IS NULL'
            )
            .run(now, kind, host)
    }

    // The page stays readable after Finish so a second click is answered
    // with the same redirect instead of an error page that loses the code.
    completePending(
        pending: PendingAuthorization,
        code: string,
        redirect: string,
        now: number
    ): void {
        this.db.transaction(() => {
            this.db
                .query('UPDATE pending SET finished_redirect = ? WHERE id = ?')
                .run(seal(this.key, redirect), hashToken(pending.id))
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
                    now + CODE_TTL_MS
                )
        })()
    }

    private toPending(
        pendingId: string,
        row: PendingRow | null,
        browserSecret: string | undefined,
        now: number
    ): PendingAuthorization | undefined {
        if (!row || !browserSecret) return undefined
        if (row.browser_hash !== hashToken(browserSecret)) return undefined
        if (row.created_at + PENDING_TTL_MS < now) return undefined
        return {
            id: pendingId,
            clientId: row.client_id,
            codeChallenge: row.code_challenge,
            connectionId: row.connection_id,
            createdAt: row.created_at,
            finishedRedirect: row.finished_redirect
                ? open(this.key, row.finished_redirect)
                : null,
            redirectUri: row.redirect_uri,
            resource: row.resource,
            scopes: JSON.parse(row.scopes) as string[],
            state: row.state,
        }
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

    saveToken(token: string, data: Omit<StoredToken, 'usedAt'>): void {
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
            usedAt: row.used_at,
        }
    }

    markTokenUsed(token: string, now: number): void {
        this.db
            .query('UPDATE tokens SET used_at = ? WHERE id = ?')
            .run(now, hashToken(token))
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

    getSchedule(connectionId: string): Schedule | undefined {
        const row = this.db
            .query<ScheduleRow, [string]>(
                'SELECT * FROM schedules WHERE connection_id = ?'
            )
            .get(connectionId)
        return row ? toSchedule(row) : undefined
    }

    // Changing the settings clears the last error: it belonged to the old ones.
    setSchedule(
        connectionId: string,
        settings: ScheduleSettings,
        nextRunAt: number
    ): void {
        this.db
            .query(
                `INSERT INTO schedules (connection_id, time, timezone, days, next_run_at)
                 VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT (connection_id) DO UPDATE SET
                 time = excluded.time, timezone = excluded.timezone, days = excluded.days,
                 next_run_at = excluded.next_run_at, last_error = NULL`
            )
            .run(
                connectionId,
                settings.time,
                settings.timezone,
                settings.days,
                nextRunAt
            )
    }

    deleteSchedule(connectionId: string): void {
        this.db
            .query('DELETE FROM schedules WHERE connection_id = ?')
            .run(connectionId)
    }

    listDueSchedules(now: number): Schedule[] {
        return this.db
            .query<ScheduleRow, [number]>(
                'SELECT * FROM schedules WHERE next_run_at <= ? ORDER BY next_run_at'
            )
            .all(now)
            .map(toSchedule)
    }

    setNextRun(connectionId: string, nextRunAt: number): void {
        this.db
            .query(
                'UPDATE schedules SET next_run_at = ? WHERE connection_id = ?'
            )
            .run(nextRunAt, connectionId)
    }

    markScheduleSent(
        connectionId: string,
        sentAt: number,
        nextRunAt: number
    ): void {
        this.db
            .query(
                `UPDATE schedules SET last_sent_at = ?, last_error = NULL, next_run_at = ?
                 WHERE connection_id = ?`
            )
            .run(sentAt, nextRunAt, connectionId)
    }

    markScheduleFailed(
        connectionId: string,
        error: string,
        nextRunAt: number
    ): void {
        this.db
            .query(
                'UPDATE schedules SET last_error = ?, next_run_at = ? WHERE connection_id = ?'
            )
            .run(error, nextRunAt, connectionId)
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
