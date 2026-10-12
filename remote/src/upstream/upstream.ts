import * as oauth from 'oauth4webapi'

import type { FetchLike, ProviderKind } from '../../../src/types/standup.types'
import type { RemoteConfig } from '../config/config.types'
import type { Store } from '../store/store'
import type { Instance } from '../store/store.types'

import {
    GITHUB_HOST,
    GITHUB_INSTANCE_SCOPES,
    GITLAB_HOST,
    GITLAB_SCOPES,
} from './upstream.constants'
import type { UpstreamTokens } from './upstream.types'

export interface UpstreamApp {
    clientId: string
    clientSecret: string
    host: string
    // Registered from the connect page rather than this server's config.
    isInstance: boolean
    // An instance becomes verified, and locked, on its first sign-in.
    isVerified: boolean
    kind: ProviderKind
    scopes: string[]
}

export interface UpstreamDeps {
    baseUrl: URL
    config: RemoteConfig
    fetchImpl: FetchLike
    store: Store
}

// GitHub and gitlab.com keep the short callback paths their applications
// were registered with; every other host carries its name.
export function appPath(kind: ProviderKind, host: string): string {
    const isBuiltIn =
        (kind === 'github' && host === GITHUB_HOST) ||
        (kind === 'gitlab' && host === GITLAB_HOST)
    return isBuiltIn ? kind : `${kind}/${host}`
}

export function callbackUrl(
    baseUrl: URL,
    kind: ProviderKind,
    host: string
): string {
    return new URL(`/connect/callback/${appPath(kind, host)}`, baseUrl).href
}

// GitHub returns an `iss` parameter on the callback (RFC 9207) naming
// https://<host>/login/oauth, not the bare host, and the callback is
// rejected unless the issuer matches it exactly.
export function authorizationServer(
    kind: ProviderKind,
    host: string
): oauth.AuthorizationServer {
    return kind === 'github'
        ? {
              issuer: `https://${host}/login/oauth`,
              authorization_endpoint: `https://${host}/login/oauth/authorize`,
              token_endpoint: `https://${host}/login/oauth/access_token`,
          }
        : {
              issuer: `https://${host}`,
              authorization_endpoint: `https://${host}/oauth/authorize`,
              token_endpoint: `https://${host}/oauth/token`,
          }
}

function fromInstance(instance: Instance): UpstreamApp {
    return {
        kind: instance.kind,
        host: instance.host,
        clientId: instance.clientId,
        clientSecret: instance.clientSecret,
        isInstance: true,
        isVerified: instance.verifiedAt !== null,
        // A GitHub Enterprise OAuth app has no read-only scope for private
        // pull requests; `repo` is the only one that reaches them.
        scopes:
            instance.kind === 'github' ? GITHUB_INSTANCE_SCOPES : GITLAB_SCOPES,
    }
}

function builtInApps(config: RemoteConfig): UpstreamApp[] {
    const apps: UpstreamApp[] = []
    if (config.github) {
        // A GitHub App's user tokens carry the app's own read-only
        // permissions; it takes no scopes.
        apps.push({
            kind: 'github',
            host: GITHUB_HOST,
            isInstance: false,
            isVerified: true,
            scopes: [],
            ...config.github,
        })
    }
    if (config.gitlab) {
        apps.push({
            kind: 'gitlab',
            host: GITLAB_HOST,
            isInstance: false,
            isVerified: true,
            scopes: GITLAB_SCOPES,
            ...config.gitlab,
        })
    }
    return apps
}

function toUpstreamTokens(
    response: oauth.TokenEndpointResponse,
    now: number
): UpstreamTokens {
    return {
        accessToken: response.access_token,
        refreshToken: response.refresh_token ?? null,
        expiresAt: response.expires_in
            ? now + response.expires_in * 1000
            : null,
    }
}

// Every request to an upstream goes through the guarded fetch: hosts here
// can be typed in by anyone, so the token exchange is as exposed as the
// API calls that follow it.
export function createUpstream(deps: UpstreamDeps) {
    const builtIn = builtInApps(deps.config)
    const options = { [oauth.customFetch]: deps.fetchImpl }

    function server(app: UpstreamApp): oauth.AuthorizationServer {
        return authorizationServer(app.kind, app.host)
    }

    function client(app: UpstreamApp) {
        return {
            client: { client_id: app.clientId },
            auth: oauth.ClientSecretPost(app.clientSecret),
        }
    }

    return {
        builtIn,

        resolve(kind: ProviderKind, host: string): UpstreamApp | undefined {
            const configured = builtIn.find(
                app => app.kind === kind && app.host === host
            )
            if (configured) return configured
            const instance = deps.store.getInstance(kind, host)
            return instance ? fromInstance(instance) : undefined
        },

        async authorizationUrl(
            app: UpstreamApp,
            state: string,
            codeVerifier: string
        ): Promise<string> {
            const url = new URL(server(app).authorization_endpoint!)
            url.search = new URLSearchParams({
                client_id: app.clientId,
                redirect_uri: callbackUrl(deps.baseUrl, app.kind, app.host),
                response_type: 'code',
                state,
                code_challenge:
                    await oauth.calculatePKCECodeChallenge(codeVerifier),
                code_challenge_method: 'S256',
                ...(app.scopes.length ? { scope: app.scopes.join(' ') } : {}),
            }).toString()
            return url.href
        },

        async exchangeCode(
            app: UpstreamApp,
            callback: URL,
            state: string,
            codeVerifier: string,
            now: number
        ): Promise<UpstreamTokens> {
            const as = server(app)
            const { client: oauthClient, auth } = client(app)
            const params = oauth.validateAuthResponse(
                as,
                oauthClient,
                callback,
                state
            )
            const response = await oauth.authorizationCodeGrantRequest(
                as,
                oauthClient,
                auth,
                params,
                callbackUrl(deps.baseUrl, app.kind, app.host),
                codeVerifier,
                options
            )
            return toUpstreamTokens(
                await oauth.processAuthorizationCodeResponse(
                    as,
                    oauthClient,
                    response
                ),
                now
            )
        },

        async refresh(
            app: UpstreamApp,
            refreshToken: string,
            now: number
        ): Promise<UpstreamTokens> {
            const as = server(app)
            const { client: oauthClient, auth } = client(app)
            const response = await oauth.refreshTokenGrantRequest(
                as,
                oauthClient,
                auth,
                refreshToken,
                options
            )
            return toUpstreamTokens(
                await oauth.processRefreshTokenResponse(
                    as,
                    oauthClient,
                    response
                ),
                now
            )
        },
    }
}

export type Upstream = ReturnType<typeof createUpstream>
