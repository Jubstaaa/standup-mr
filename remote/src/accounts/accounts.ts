import * as oauth from 'oauth4webapi'

import type { Provider } from '../../../src/providers/base/base.types'
import { GitHubProvider } from '../../../src/providers/github/github'
import { GitLabProvider } from '../../../src/providers/gitlab/gitlab'
import type { FetchLike, ProviderKind } from '../../../src/standup.types'
import { errorDetail } from '../errors/errors'
import type { AccountRepository } from '../store/account-repository'
import type { Upstream } from '../upstream/upstream'
import type { UpstreamTokens } from '../upstream/upstream.types'

import { REFRESH_CLAIM_MS, REFRESH_MARGIN_MS } from './accounts.constants'
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

// Only the host saying no to the refresh token means it is dead; RFC 6749
// answers every token error with 400, so the status alone says nothing.
function isRefusedGrant(error: unknown): boolean {
    return (
        error instanceof oauth.ResponseBodyError &&
        error.error === 'invalid_grant'
    )
}

// The host refused the sign-in app itself (a rotated or revoked secret):
// reconnecting goes through the same app, so it cannot help.
function isRejectedClient(error: unknown): boolean {
    return (
        error instanceof oauth.ResponseBodyError &&
        (error.error === 'invalid_client' ||
            error.error === 'unauthorized_client')
    )
}

function refreshFailure(account: Account, cause: unknown): Error {
    if (isRefusedGrant(cause)) {
        return new AccountError(
            `The ${describeAccount(account)} login could not be renewed. Reconnect the connector.`
        )
    }
    if (isRejectedClient(cause)) {
        return new Error(
            `The ${account.host} sign-in app was rejected, so the ${describeAccount(account)} login cannot be renewed. The server operator has to fix the app; reconnecting will not help.`,
            { cause }
        )
    }
    return new Error(
        `The ${describeAccount(account)} login could not be renewed right now. Try again in a few minutes.`,
        { cause }
    )
}

// OAuth tokens expire (GitHub after 8h, GitLab after 2h) and their refresh
// tokens are single-use. Refreshes are shared per account within a process
// and claimed in the database across processes, so no two calls ever spend
// the same refresh token.
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
        if (!accounts.claimRefresh(account.id, now, now + REFRESH_CLAIM_MS)) {
            throw new Error(
                `The ${describeAccount(account)} login is being renewed by another request. Try again in a moment.`
            )
        }
        let tokens: UpstreamTokens
        try {
            tokens = await upstream.refresh(app, account.refreshToken, now)
        } catch (cause) {
            accounts.releaseRefresh(account.id)
            const refusal =
                cause instanceof oauth.ResponseBodyError
                    ? ` (${cause.error}, HTTP ${cause.status})`
                    : ''
            console.error(
                `token renewal failed for ${describeAccount(account)}: ${errorDetail(cause)}${refusal}`
            )
            throw refreshFailure(account, cause)
        }
        // The old refresh token is spent now: a save that fails cannot be
        // retried with it, so this is never reported as temporary.
        try {
            accounts.updateTokens(account.id, tokens)
        } catch (cause) {
            console.error(
                `renewed tokens for ${describeAccount(account)} could not be saved: ${errorDetail(cause)}`
            )
            throw new AccountError(
                `The ${describeAccount(account)} login was renewed but could not be saved. Reconnect the connector.`
            )
        }
        return tokens.accessToken
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
