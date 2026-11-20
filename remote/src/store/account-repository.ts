import { randomUUID } from 'node:crypto'

import type { Database } from 'bun:sqlite'

import type { Account, NewAccount } from '../accounts/accounts.types'
import { open, seal } from '../crypto/crypto'
import type { UpstreamTokens } from '../upstream/upstream.types'

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

// Git hosting accounts linked to a connection; tokens are sealed at rest.
export class AccountRepository {
    constructor(
        private readonly db: Database,
        private readonly key: Buffer
    ) {}

    add(account: NewAccount): Account {
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
                randomUUID(),
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
        return this.list(account.connectionId).find(
            a => a.provider === account.provider && a.host === account.host
        )!
    }

    get(accountId: string): Account | undefined {
        const row = this.db
            .query<AccountRow, [string]>('SELECT * FROM accounts WHERE id = ?')
            .get(accountId)
        return row ? this.toAccount(row) : undefined
    }

    list(connectionId: string): Account[] {
        return this.db
            .query<AccountRow, [string]>(
                'SELECT * FROM accounts WHERE connection_id = ? ORDER BY provider, host'
            )
            .all(connectionId)
            .map(row => this.toAccount(row))
    }

    private toAccount(row: AccountRow): Account {
        return {
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
        }
    }

    remove(connectionId: string, accountId: string): void {
        this.db
            .query('DELETE FROM accounts WHERE connection_id = ? AND id = ?')
            .run(connectionId, accountId)
    }

    // True only for the caller that took the claim; one left by a server
    // that died lapses at its expiry.
    claimRefresh(accountId: string, now: number, until: number): boolean {
        return (
            this.db
                .query(
                    `UPDATE accounts SET refresh_claimed_until = ? WHERE id = ?
                     AND (refresh_claimed_until IS NULL OR refresh_claimed_until <= ?)`
                )
                .run(until, accountId, now).changes === 1
        )
    }

    releaseRefresh(accountId: string): void {
        this.db
            .query(
                'UPDATE accounts SET refresh_claimed_until = NULL WHERE id = ?'
            )
            .run(accountId)
    }

    updateTokens(accountId: string, tokens: UpstreamTokens): void {
        const result = this.db
            .query(
                `UPDATE accounts SET access_token = ?,
                 refresh_token = COALESCE(?, refresh_token), expires_at = ?,
                 refresh_claimed_until = NULL WHERE id = ?`
            )
            .run(
                seal(this.key, tokens.accessToken),
                tokens.refreshToken
                    ? seal(this.key, tokens.refreshToken)
                    : null,
                tokens.expiresAt,
                accountId
            )
        // A refresh that lands after the account was removed must not look
        // like it was saved.
        if (result.changes !== 1) {
            throw new Error(
                `Account ${accountId} is missing; tokens not saved.`
            )
        }
    }
}
