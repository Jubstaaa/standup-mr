import type { FetchLike, ProviderKind } from '../../src/types/standup.types'

import type { RemoteConfig, UpstreamTokens } from './remote.types'

export interface UpstreamApp {
    authorizeUrl: string
    clientId: string
    clientSecret: string
    host: string
    kind: ProviderKind
    scope?: string
    tokenUrl: string
}

interface TokenResponse {
    access_token?: string
    error?: string
    error_description?: string
    expires_in?: number
    refresh_token?: string
}

export function upstreamApps(
    config: RemoteConfig
): Partial<Record<ProviderKind, UpstreamApp>> {
    const apps: Partial<Record<ProviderKind, UpstreamApp>> = {}
    if (config.github) {
        // A GitHub App's user tokens carry the app's own read-only
        // permissions; it takes no scope parameter.
        apps.github = {
            kind: 'github',
            host: 'github.com',
            authorizeUrl: 'https://github.com/login/oauth/authorize',
            tokenUrl: 'https://github.com/login/oauth/access_token',
            ...config.github,
        }
    }
    if (config.gitlab) {
        apps.gitlab = {
            kind: 'gitlab',
            host: 'gitlab.com',
            authorizeUrl: 'https://gitlab.com/oauth/authorize',
            tokenUrl: 'https://gitlab.com/oauth/token',
            scope: 'read_api read_user',
            ...config.gitlab,
        }
    }
    return apps
}

export function authorizationUrl(
    app: UpstreamApp,
    redirectUri: string,
    state: string
): string {
    const url = new URL(app.authorizeUrl)
    url.searchParams.set('client_id', app.clientId)
    url.searchParams.set('redirect_uri', redirectUri)
    url.searchParams.set('state', state)
    url.searchParams.set('response_type', 'code')
    if (app.scope) url.searchParams.set('scope', app.scope)
    return url.href
}

async function requestTokens(
    app: UpstreamApp,
    params: Record<string, string>,
    now: number,
    fetchImpl: FetchLike
): Promise<UpstreamTokens> {
    const response = await fetchImpl(app.tokenUrl, {
        method: 'POST',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
            client_id: app.clientId,
            client_secret: app.clientSecret,
            ...params,
        }).toString(),
    })
    // GitHub reports a bad code as HTTP 200 with an `error` field.
    const body = (await response.json().catch(() => ({}))) as TokenResponse
    if (!response.ok || body.error || !body.access_token) {
        throw new Error(
            body.error_description ??
                body.error ??
                `${app.host} refused the token request (HTTP ${response.status}).`
        )
    }
    return {
        accessToken: body.access_token,
        refreshToken: body.refresh_token ?? null,
        expiresAt: body.expires_in ? now + body.expires_in * 1000 : null,
    }
}

export function exchangeCode(
    app: UpstreamApp,
    code: string,
    redirectUri: string,
    now: number,
    fetchImpl: FetchLike = fetch
): Promise<UpstreamTokens> {
    return requestTokens(
        app,
        { grant_type: 'authorization_code', code, redirect_uri: redirectUri },
        now,
        fetchImpl
    )
}

export function refreshTokens(
    app: UpstreamApp,
    refreshToken: string,
    now: number,
    fetchImpl: FetchLike = fetch
): Promise<UpstreamTokens> {
    return requestTokens(
        app,
        { grant_type: 'refresh_token', refresh_token: refreshToken },
        now,
        fetchImpl
    )
}
