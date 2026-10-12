import { GitHub, GitLab } from 'arctic'
import type { OAuth2Tokens } from 'arctic'

import type { ProviderKind } from '../../src/types/standup.types'

import type { RemoteConfig, UpstreamTokens } from './remote.types'
import { GITLAB_SCOPES } from './upstream.constants'

export interface UpstreamApp {
    client: GitHub | GitLab
    host: string
    kind: ProviderKind
    scopes: string[]
}

export type UpstreamApps = Partial<Record<ProviderKind, UpstreamApp>>

export function callbackUrl(baseUrl: URL, kind: ProviderKind): string {
    return new URL(`/connect/callback/${kind}`, baseUrl).href
}

export function upstreamApps(config: RemoteConfig): UpstreamApps {
    const apps: UpstreamApps = {}
    if (config.github) {
        // A GitHub App's user tokens carry the app's own read-only
        // permissions; it takes no scopes.
        apps.github = {
            kind: 'github',
            host: 'github.com',
            scopes: [],
            client: new GitHub(
                config.github.clientId,
                config.github.clientSecret,
                callbackUrl(config.baseUrl, 'github')
            ),
        }
    }
    if (config.gitlab) {
        apps.gitlab = {
            kind: 'gitlab',
            host: 'gitlab.com',
            scopes: GITLAB_SCOPES,
            client: new GitLab(
                'https://gitlab.com',
                config.gitlab.clientId,
                config.gitlab.clientSecret,
                callbackUrl(config.baseUrl, 'gitlab')
            ),
        }
    }
    return apps
}

export function toUpstreamTokens(tokens: OAuth2Tokens): UpstreamTokens {
    const expires = 'expires_in' in tokens.data
    return {
        accessToken: tokens.accessToken(),
        refreshToken: tokens.hasRefreshToken() ? tokens.refreshToken() : null,
        expiresAt: expires ? tokens.accessTokenExpiresAt().getTime() : null,
    }
}
