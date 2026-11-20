import * as oauth from 'oauth4webapi'

import type { Provider } from '../../../src/providers/base/base.types'
import { GitHubProvider } from '../../../src/providers/github/github'
import { GitLabProvider } from '../../../src/providers/gitlab/gitlab'
import type { FetchLike, ProviderKind } from '../../../src/standup.types'
import { errorDetail } from '../errors/errors'
import type { AccountRepository } from '../store/account-repository'
import type { Upstream } from '../upstream/upstream'

import { REFRESH_MARGIN_MS } from './accounts.constants'
import type { Account } from './accounts.types'

export class AccountError extends Error {}

export function describeAccount(account: Account): string {
    return `${account.provider} · ${account.host} · ${account.username}`
}

export function providerFor(
    kind: ProviderKind,
    host: string,
    token: string,
    fetchImpl?: FetchLike
): Provider {
    return kind === 'github'
        ? new GitHubProvider(host, token, fetchImpl)
        : new GitLabProvider(host, token, fetchImpl)
}

export function pickAccount(
    accounts: Account[],
    filter: { host?: string; provider?: ProviderKind }
): Account {
    if (accounts.length === 0) {
        throw new AccountError(
            'No account is linked to this connector. Reconnect it and link GitHub or GitLab.'
        )
    }
    const host = filter.host?.toLowerCase()
    const matches = accounts.filter(
        account =>
            (!filter.provider || account.provider === filter.provider) &&
            (!host || account.host === host)
    )
    if (matches.length === 1) return matches[0]!

    const linked = accounts.map(describeAccount).join('; ')
    if (matches.length === 0) {
        throw new AccountError(
            `No linked account matches. Linked accounts: ${linked}.`
        )
    }
    throw new AccountError(
        `Several accounts are linked (${linked}). Pass provider or host to pick one — ask the user which they mean.`
    )
}

function isCurrent(account: Account, now: number): boolean {
    return (
        account.source !== 'oauth' ||
        account.expiresAt === null ||
        account.expiresAt - REFRESH_MARGIN_MS > now
    )
}

// Only the host saying no to the refresh token means it is dead; a network
// or database error is worth another try, not a reconnect.
function isRefusedGrant(error: unknown): boolean {
    return (
        error instanceof oauth.ResponseBodyError &&
        (error.error === 'invalid_grant' ||
            error.status === 400 ||
            error.status === 401)
    )
}

// OAuth tokens expire (GitHub after 8h, GitLab after 2h) and their refresh
// tokens are single-use. Refreshes are shared per account, so two
// concurrent tool calls never spend the same refresh token twice.
export function createTokenRefresher(
    upstream: Pick<Upstream, 'refresh' | 'resolve'>,
    accounts: AccountRepository
) {
    const inFlight = new Map<string, Promise<string>>()

    // The caller's copy may predate a refresh that already finished; its
    // refresh token is then spent, so the stored row is the one that counts.
    async function refresh(stale: Account, now: number): Promise<string> {
        const account = accounts.get(stale.id)
        if (!account) {
            throw new AccountError(
                `The ${describeAccount(stale)} account is no longer linked. Reconnect the connector.`
            )
        }
        if (isCurrent(account, now)) return account.accessToken
        const app = upstream.resolve(
            account.provider,
            account.host,
            account.connectionId
        )
        if (!app || !account.refreshToken) {
            throw new AccountError(
                `The ${describeAccount(account)} login has expired. Reconnect the connector.`
            )
        }
        try {
            const tokens = await upstream.refresh(
                app,
                account.refreshToken,
                now
            )
            accounts.updateTokens(account.id, tokens)
            return tokens.accessToken
        } catch (cause) {
            const refusal =
                cause instanceof oauth.ResponseBodyError
                    ? ` (${cause.error}, HTTP ${cause.status})`
                    : ''
            console.error(
                `token renewal failed for ${describeAccount(account)}: ${errorDetail(cause)}${refusal}`
            )
            if (isRefusedGrant(cause)) {
                throw new AccountError(
                    `The ${describeAccount(account)} login could not be renewed. Reconnect the connector.`
                )
            }
            throw new Error(
                `The ${describeAccount(account)} login could not be renewed right now. Try again in a few minutes.`,
                { cause }
            )
        }
    }

    return async function freshAccessToken(
        account: Account,
        now: number
    ): Promise<string> {
        if (isCurrent(account, now)) return account.accessToken

        const pending = inFlight.get(account.id)
        if (pending) return pending
        const refreshing = refresh(account, now).finally(() =>
            inFlight.delete(account.id)
        )
        inFlight.set(account.id, refreshing)
        return refreshing
    }
}

export type TokenRefresher = ReturnType<typeof createTokenRefresher>
