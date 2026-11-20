import { randomUUID } from 'node:crypto'

import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js'
import {
    InvalidClientMetadataError,
    InvalidGrantError,
    InvalidTargetError,
    InvalidTokenError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js'
import type {
    AuthorizationParams,
    OAuthServerProvider,
} from '@modelcontextprotocol/sdk/server/auth/provider.js'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import type {
    OAuthClientInformationFull,
    OAuthTokenRevocationRequest,
    OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js'
import type { Response } from 'express'

import { connectCookie } from '../connect/connect-cookie'
import { LOOPBACK_HOSTS } from '../connect/connect.constants'
import { randomToken } from '../crypto/crypto'
import type { Store } from '../store/store'
import {
    ACCESS_TOKEN_TTL_MS,
    REFRESH_REUSE_GRACE_MS,
    REFRESH_TOKEN_TTL_MS,
} from '../store/store.constants'

export interface OAuthProviderOptions {
    mcpUrl: URL
    now?: () => number
    // The configured site URL, which the connect pages read the cookie by.
    siteUrl: URL
}

const SCRIPT_SCHEMES = ['javascript:', 'data:', 'vbscript:', 'file:']

// The code travels to the redirect URI, so plain http is only accepted on
// loopback (a native app on the user's own machine, RFC 8252); a custom
// scheme is how desktop clients such as Cursor sign in.
function assertSafeRedirects(redirectUris: string[]): void {
    for (const redirect of redirectUris) {
        const url = URL.parse(redirect)
        const isSafe =
            url !== null &&
            (url.protocol === 'https:' ||
                (url.protocol === 'http:' &&
                    LOOPBACK_HOSTS.includes(url.hostname)) ||
                (url.protocol !== 'http:' &&
                    !SCRIPT_SCHEMES.includes(url.protocol)))
        if (!isSafe) {
            throw new InvalidClientMetadataError(
                `Redirect URI ${redirect} must use https, or http on localhost.`
            )
        }
    }
}

export class StandupOAuthProvider implements OAuthServerProvider {
    readonly clientsStore: OAuthRegisteredClientsStore

    private readonly mcpUrl: URL
    private readonly now: () => number
    private readonly siteUrl: URL

    constructor(
        private readonly store: Store,
        options: OAuthProviderOptions
    ) {
        this.mcpUrl = options.mcpUrl
        this.now = options.now ?? Date.now
        this.siteUrl = options.siteUrl
        this.clientsStore = {
            getClient: id => store.clients.get(id),
            registerClient: client => {
                // The SDK fills in client_id before calling us; the type just
                // does not say so.
                const full = client as OAuthClientInformationFull
                assertSafeRedirects(full.redirect_uris)
                store.clients.save(full, this.now())
                return full
            },
        }
    }

    async authorize(
        client: OAuthClientInformationFull,
        params: AuthorizationParams,
        res: Response
    ): Promise<void> {
        if (params.resource && !this.isOwnResource(params.resource.href)) {
            throw new InvalidTargetError(
                `This server only issues tokens for ${this.mcpUrl.href}`
            )
        }
        const pendingId = randomToken()
        const browserSecret = randomToken()
        this.store.authorizations.createPending(
            {
                pendingId,
                browserSecret,
                clientId: client.client_id,
                codeChallenge: params.codeChallenge,
                redirectUri: params.redirectUri,
                resource: params.resource?.href ?? null,
                scopes: params.scopes ?? [],
                state: params.state ?? null,
            },
            this.now()
        )
        const cookie = connectCookie(this.siteUrl)
        res.cookie(cookie.name, browserSecret, cookie.options)
        res.redirect(`/connect/${pendingId}`)
    }

    async challengeForAuthorizationCode(
        client: OAuthClientInformationFull,
        authorizationCode: string
    ): Promise<string> {
        const code = this.store.authorizations.peekCode(
            authorizationCode,
            this.now()
        )
        if (!code || code.clientId !== client.client_id) {
            throw new InvalidGrantError('Invalid or expired authorization code')
        }
        return code.codeChallenge
    }

    async exchangeAuthorizationCode(
        client: OAuthClientInformationFull,
        authorizationCode: string,
        _codeVerifier?: string,
        redirectUri?: string
    ): Promise<OAuthTokens> {
        const code = this.store.authorizations.takeCode(
            authorizationCode,
            this.now()
        )
        if (!code || code.clientId !== client.client_id) {
            throw new InvalidGrantError('Invalid or expired authorization code')
        }
        if (redirectUri !== code.redirectUri) {
            throw new InvalidGrantError('redirect_uri does not match')
        }
        return this.issue(
            client.client_id,
            code.connectionId,
            randomUUID(),
            code.scopes,
            code.resource
        )
    }

    async exchangeRefreshToken(
        client: OAuthClientInformationFull,
        refreshToken: string
    ): Promise<OAuthTokens> {
        const stored = this.store.tokens.get(refreshToken)
        if (
            !stored ||
            stored.kind !== 'refresh' ||
            stored.clientId !== client.client_id ||
            stored.expiresAt < this.now()
        ) {
            throw new InvalidGrantError('Invalid refresh token')
        }
        // A rotated refresh token coming back means two parties hold it —
        // one of them stole it. Kill the whole family and make both reconnect.
        // A client retrying within a minute (a lost response) is let through.
        const now = this.now()
        if (stored.usedAt !== null) {
            if (now - stored.usedAt > REFRESH_REUSE_GRACE_MS) {
                this.store.tokens.revokeFamily(stored.family)
                throw new InvalidGrantError('Refresh token reuse detected')
            }
        } else {
            this.store.tokens.markUsed(refreshToken, now)
        }
        return this.issue(
            client.client_id,
            stored.connectionId,
            stored.family,
            stored.scopes,
            stored.resource
        )
    }

    async verifyAccessToken(token: string): Promise<AuthInfo> {
        const stored = this.store.tokens.get(token)
        if (
            !stored ||
            stored.kind !== 'access' ||
            stored.expiresAt < this.now() ||
            (stored.resource !== null && !this.isOwnResource(stored.resource))
        ) {
            throw new InvalidTokenError('Invalid or expired access token')
        }
        return {
            token,
            clientId: stored.clientId,
            scopes: stored.scopes,
            expiresAt: Math.floor(stored.expiresAt / 1000),
            resource: stored.resource ? new URL(stored.resource) : undefined,
            extra: { connectionId: stored.connectionId },
        }
    }

    // Revoking either token removes the whole connection with its linked
    // accounts: disconnecting in the client is how a user deletes their data.
    async revokeToken(
        client: OAuthClientInformationFull,
        request: OAuthTokenRevocationRequest
    ): Promise<void> {
        const stored = this.store.tokens.get(request.token)
        if (!stored || stored.clientId !== client.client_id) return
        this.store.connections.delete(stored.connectionId)
    }

    // Clients differ on a trailing slash; anything else is another resource.
    private isOwnResource(resource: string): boolean {
        const trim = (url: string) => url.replace(/\/+$/, '')
        return trim(resource) === trim(this.mcpUrl.href)
    }

    private issue(
        clientId: string,
        connectionId: string,
        family: string,
        scopes: string[],
        resource: string | null
    ): OAuthTokens {
        const now = this.now()
        const accessToken = randomToken()
        const refreshToken = randomToken()
        const base = { clientId, connectionId, family, scopes, resource }
        this.store.tokens.save(accessToken, {
            ...base,
            kind: 'access',
            expiresAt: now + ACCESS_TOKEN_TTL_MS,
        })
        this.store.tokens.save(refreshToken, {
            ...base,
            kind: 'refresh',
            expiresAt: now + REFRESH_TOKEN_TTL_MS,
        })
        this.store.connections.touch(connectionId, now)
        return {
            access_token: accessToken,
            token_type: 'Bearer',
            expires_in: ACCESS_TOKEN_TTL_MS / 1000,
            refresh_token: refreshToken,
            scope: scopes.join(' ') || undefined,
        }
    }
}
