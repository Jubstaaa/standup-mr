import type { Provider } from '../../src/providers/base/base.types'
import { GitHubProvider } from '../../src/providers/github/github'
import { GitLabProvider } from '../../src/providers/gitlab/gitlab'
import type { FetchLike, ProviderKind } from '../../src/types/standup.types'

import { REFRESH_MARGIN_MS } from './accounts.constants'
import type { Account } from './remote.types'
import type { Store } from './store'
import { refreshTokens } from './upstream'
import type { UpstreamApp } from './upstream'

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

// OAuth tokens expire (GitHub after 8h, gitlab.com after 2h); refresh just
// before that so a tool call never runs on a token about to die.
export async function freshAccessToken(
    account: Account,
    apps: Partial<Record<ProviderKind, UpstreamApp>>,
    store: Store,
    now: number,
    fetchImpl?: FetchLike
): Promise<string> {
    if (
        account.source !== 'oauth' ||
        account.expiresAt === null ||
        account.expiresAt - REFRESH_MARGIN_MS > now
    ) {
        return account.accessToken
    }
    const app = apps[account.provider]
    if (!app || !account.refreshToken) {
        throw new AccountError(
            `The ${describeAccount(account)} login has expired. Reconnect the connector.`
        )
    }
    try {
        const tokens = await refreshTokens(
            app,
            account.refreshToken,
            now,
            fetchImpl
        )
        store.updateAccountTokens(account.id, tokens)
        return tokens.accessToken
    } catch {
        throw new AccountError(
            `The ${describeAccount(account)} login could not be renewed. Reconnect the connector.`
        )
    }
}
