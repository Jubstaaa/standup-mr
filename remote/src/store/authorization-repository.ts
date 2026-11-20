import { randomUUID } from 'node:crypto'

import type { Database } from 'bun:sqlite'
import { z } from 'zod'

import { hashToken, open, seal } from '../crypto/crypto'

import { CODE_TTL_MS, PENDING_TTL_MS } from './store.constants'
import type {
    AuthCode,
    NewPending,
    PendingAuthorization,
    UpstreamLogin,
} from './store.types'
import { parseStored, scopesSchema } from './stored-json'

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

interface CodeRow {
    client_id: string
    code_challenge: string
    connection_id: string
    expires_at: number
    redirect_uri: string
    resource: string | null
    scopes: string
}

const upstreamReturnSchema = z.object({
    codeVerifier: z.string(),
    pendingId: z.string(),
})

// One sign-in from start to code: the pending page, the upstream login it
// hands off to, and the authorization code it ends with. Starting one also
// creates the connection the sign-in is for.
export class AuthorizationRepository {
    constructor(
        private readonly db: Database,
        private readonly key: Buffer
    ) {}

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
        const login = parseStored(
            upstreamReturnSchema,
            open(this.key, row.upstream_return),
            'upstream login'
        )
        const pending = this.toPending(login.pendingId, row, browserSecret, now)
        return pending
            ? { pending, codeVerifier: login.codeVerifier }
            : undefined
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
            scopes: parseStored(scopesSchema, row.scopes, 'code scopes'),
        }
    }

    takeCode(code: string, now: number): AuthCode | undefined {
        const found = this.peekCode(code, now)
        this.db.query('DELETE FROM codes WHERE id = ?').run(hashToken(code))
        return found
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
            scopes: parseStored(scopesSchema, row.scopes, 'pending scopes'),
            state: row.state,
        }
    }
}
