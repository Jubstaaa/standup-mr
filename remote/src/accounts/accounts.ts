import type { Provider } from '../../../src/providers/base/base.types'
import { GitHubProvider } from '../../../src/providers/github/github'
import { GitLabProvider } from '../../../src/providers/gitlab/gitlab'
import type { FetchLike, ProviderKind } from '../../../src/types/standup.types'
import type { Store } from '../store/store'
import { findApp, toUpstreamTokens } from '../upstream/upstream'
import type { UpstreamApps } from '../upstream/upstream'

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

// OAuth tokens expire (GitHub after 8h, gitlab.com after 2h) and their
// refresh tokens are single-use. Refreshes are shared per account, so two
// concurrent tool calls never spend the same refresh token twice.
export function createTokenRefresher(apps: UpstreamApps, store: Store) {
    const inFlight = new Map<string, Promise<string>>()

    async function refresh(account: Account): Promise<string> {
        const app = findApp(apps, account.provider, account.host)
        if (!app || !account.refreshToken) {
            throw new AccountError(
                `The ${describeAccount(account)} login has expired. Reconnect the connector.`
            )
        }
        try {
            const tokens = toUpstreamTokens(
                await app.client.refreshAccessToken(account.refreshToken)
            )
            store.updateAccountTokens(account.id, tokens)
            return tokens.accessToken
        } catch {
            throw new AccountError(
                `The ${describeAccount(account)} login could not be renewed. Reconnect the connector.`
            )
        }
    }

    return async function freshAccessToken(
        account: Account,
        now: number
    ): Promise<string> {
        const isCurrent =
            account.source !== 'oauth' ||
            account.expiresAt === null ||
            account.expiresAt - REFRESH_MARGIN_MS > now
        if (isCurrent) return account.accessToken

        const pending = inFlight.get(account.id)
        if (pending) return pending
        const refreshing = refresh(account).finally(() =>
            inFlight.delete(account.id)
        )
        inFlight.set(account.id, refreshing)
        return refreshing
    }
}

export type TokenRefresher = ReturnType<typeof createTokenRefresher>
