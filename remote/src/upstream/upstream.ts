import { GitHub, GitLab } from 'arctic'
import type { OAuth2Tokens } from 'arctic'

import type { ProviderKind } from '../../../src/types/standup.types'
import type { AppCredentials, RemoteConfig } from '../config/config.types'

import { GITHUB_HOST, GITLAB_HOST, GITLAB_SCOPES } from './upstream.constants'
import type { UpstreamTokens } from './upstream.types'

export interface UpstreamApp {
    client: GitHub | GitLab
    host: string
    kind: ProviderKind
    // Route segment for the link and callback URLs: "github", "gitlab", or
    // "gitlab/<host>" for a self-hosted instance registered in the config.
    path: string
    scopes: string[]
}

export type UpstreamApps = UpstreamApp[]

export function callbackUrl(baseUrl: URL, path: string): string {
    return new URL(`/connect/callback/${path}`, baseUrl).href
}

export function findApp(
    apps: UpstreamApps,
    kind: ProviderKind,
    host: string
): UpstreamApp | undefined {
    return apps.find(app => app.kind === kind && app.host === host)
}

function gitlabApp(
    baseUrl: URL,
    host: string,
    path: string,
    credentials: AppCredentials
): UpstreamApp {
    return {
        kind: 'gitlab',
        host,
        path,
        scopes: GITLAB_SCOPES,
        client: new GitLab(
            `https://${host}`,
            credentials.clientId,
            credentials.clientSecret,
            callbackUrl(baseUrl, path)
        ),
    }
}

export function upstreamApps(config: RemoteConfig): UpstreamApps {
    const apps: UpstreamApps = []
    if (config.github) {
        // A GitHub App's user tokens carry the app's own read-only
        // permissions; it takes no scopes.
        apps.push({
            kind: 'github',
            host: GITHUB_HOST,
            path: 'github',
            scopes: [],
            client: new GitHub(
                config.github.clientId,
                config.github.clientSecret,
                callbackUrl(config.baseUrl, 'github')
            ),
        })
    }
    if (config.gitlab) {
        apps.push(
            gitlabApp(config.baseUrl, GITLAB_HOST, 'gitlab', config.gitlab)
        )
    }
    for (const instance of config.gitlabInstances) {
        apps.push(
            gitlabApp(
                config.baseUrl,
                instance.host,
                `gitlab/${instance.host}`,
                instance
            )
        )
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
