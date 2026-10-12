import { randomUUID } from 'node:crypto'

import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js'
import {
    InvalidGrantError,
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

import { randomToken } from './crypto'
import type { Store } from './store'
import { ACCESS_TOKEN_TTL_MS, REFRESH_TOKEN_TTL_MS } from './store.constants'

export class StandupOAuthProvider implements OAuthServerProvider {
    readonly clientsStore: OAuthRegisteredClientsStore

    constructor(
        private readonly store: Store,
        private readonly now: () => number = Date.now
    ) {
        this.clientsStore = {
            getClient: id => store.getClient(id),
            registerClient: client => {
                // The SDK fills in client_id before calling us; the type just
                // does not say so.
                const full = client as OAuthClientInformationFull
                store.saveClient(full)
                return full
            },
        }
    }

    async authorize(
        client: OAuthClientInformationFull,
        params: AuthorizationParams,
        res: Response
    ): Promise<void> {
        const pendingId = randomToken()
        this.store.createPending(
            {
                clientId: client.client_id,
                codeChallenge: params.codeChallenge,
                redirectUri: params.redirectUri,
                resource: params.resource?.href ?? null,
                scopes: params.scopes ?? [],
                state: params.state ?? null,
            },
            pendingId,
            this.now()
        )
        res.redirect(`/connect/${pendingId}`)
    }

    async challengeForAuthorizationCode(
        client: OAuthClientInformationFull,
        authorizationCode: string
    ): Promise<string> {
        const code = this.store.peekCode(authorizationCode, this.now())
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
        const code = this.store.takeCode(authorizationCode, this.now())
        if (!code || code.clientId !== client.client_id) {
            throw new InvalidGrantError('Invalid or expired authorization code')
        }
        if (redirectUri && redirectUri !== code.redirectUri) {
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
        const stored = this.store.getToken(refreshToken)
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
        if (stored.used) {
            this.store.revokeFamily(stored.family)
            throw new InvalidGrantError('Refresh token reuse detected')
        }
        this.store.markTokenUsed(refreshToken)
        return this.issue(
            client.client_id,
            stored.connectionId,
            stored.family,
            stored.scopes,
            stored.resource
        )
    }

    async verifyAccessToken(token: string): Promise<AuthInfo> {
        const stored = this.store.getToken(token)
        if (
            !stored ||
            stored.kind !== 'access' ||
            stored.expiresAt < this.now()
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
        const stored = this.store.getToken(request.token)
        if (!stored || stored.clientId !== client.client_id) return
        this.store.deleteConnection(stored.connectionId)
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
        this.store.saveToken(accessToken, {
            ...base,
            kind: 'access',
            expiresAt: now + ACCESS_TOKEN_TTL_MS,
        })
        this.store.saveToken(refreshToken, {
            ...base,
            kind: 'refresh',
            expiresAt: now + REFRESH_TOKEN_TTL_MS,
        })
        this.store.touchConnection(connectionId, now)
        return {
            access_token: accessToken,
            token_type: 'Bearer',
            expires_in: ACCESS_TOKEN_TTL_MS / 1000,
            refresh_token: refreshToken,
            scope: scopes.join(' ') || undefined,
        }
    }
}
