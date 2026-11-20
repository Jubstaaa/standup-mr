import { fileURLToPath } from 'node:url'

import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js'
import {
    getOAuthProtectedResourceMetadataUrl,
    mcpAuthRouter,
} from '@modelcontextprotocol/sdk/server/auth/router.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import express from 'express'
import type { Express } from 'express'
import { rateLimit } from 'express-rate-limit'
import helmet from 'helmet'

import type { FetchLike } from '../../../src/standup.types'
import { createTokenRefresher } from '../accounts/accounts'
import type { TokenRefresher } from '../accounts/accounts'
import type { RemoteConfig } from '../config/config.types'
import { createConnectRouter } from '../connect/connect'
import { renderLandingPage } from '../connect/connect-page'
import { errorMessage } from '../errors/errors'
import { StandupOAuthProvider } from '../oauth/oauth'
import { renderPrivacyPage, renderSupportPage } from '../pages/pages'
import { clientKey } from '../rate-limit/rate-limit'
import {
    blockedSet,
    createGuardedFetch,
    createGuardedLookup,
    createHostCheck,
} from '../ssrf/ssrf'
import type { HostCheck, Lookup } from '../ssrf/ssrf'
import { MAX_RESPONSE_BYTES } from '../ssrf/ssrf.constants'
import type { Store } from '../store/store'
import { createRemoteServer } from '../tools/tools'
import { createUpstream } from '../upstream/upstream'
import type { Upstream } from '../upstream/upstream'

import {
    ICON_CACHE,
    ICON_ROUTES,
    MCP_CALLS_PER_MINUTE,
} from './server.constants'

const ASSETS_DIR = fileURLToPath(new URL('../../../assets/', import.meta.url))

export interface AppOptions {
    fetchImpl?: FetchLike
    lookup?: Lookup
    now?: () => number
}

// Shared by the web app and the scheduler, so both go through the same
// SSRF guard and never refresh one account's token twice at once.
export interface Services {
    fetchImpl: FetchLike
    freshAccessToken: TokenRefresher
    hostCheck: HostCheck
    now: () => number
    upstream: Upstream
}

export function createServices(
    config: RemoteConfig,
    store: Store,
    options: AppOptions = {}
): Services {
    const blocked = blockedSet(config.blockedAddresses)
    const lookup = createGuardedLookup(blocked, options.lookup)
    const fetchImpl = options.fetchImpl ?? createGuardedFetch(lookup, blocked)
    // oauth4webapi reads token answers whole, so they keep a byte cap.
    const upstream = createUpstream({
        baseUrl: config.baseUrl,
        config,
        fetchImpl:
            options.fetchImpl ??
            createGuardedFetch(lookup, blocked, {
                maxResponseBytes: MAX_RESPONSE_BYTES,
            }),
        instances: store.instances,
    })
    return {
        fetchImpl,
        freshAccessToken: createTokenRefresher(upstream, store.accounts),
        hostCheck: createHostCheck(lookup),
        now: options.now ?? Date.now,
        upstream,
    }
}

export function createApp(
    config: RemoteConfig,
    store: Store,
    services: Services = createServices(config, store)
): Express {
    const app = express()
    const { fetchImpl, freshAccessToken, now, upstream } = services
    const mcpUrl = new URL('/mcp', config.baseUrl)
    const provider = new StandupOAuthProvider(store, { mcpUrl, now })
    const authLimit = { keyGenerator: clientKey }

    // Finish redirects a form POST to the client's callback, which a
    // form-action directive would block; the page itself runs no script.
    // The opener policy stays off: a client that runs the login in a popup
    // may need window.opener to learn that it finished.
    // Before helmet: its same-origin resource policy would stop other sites,
    // claude.ai among them, from showing the icon.
    for (const [route, file] of Object.entries(ICON_ROUTES)) {
        app.get(route, (_req, res) => {
            res.sendFile(file, { root: ASSETS_DIR, maxAge: ICON_CACHE })
        })
    }

    app.use(
        helmet({
            contentSecurityPolicy: {
                directives: { formAction: null, frameAncestors: ["'none'"] },
            },
            crossOriginOpenerPolicy: false,
        })
    )

    // The deploy gate polls this, so it reads the database: a release that
    // cannot read its data must fail here and be rolled back.
    app.get('/health', (_req, res) => {
        try {
            store.ping()
            res.json({ ok: true })
        } catch (cause) {
            console.error(`health check failed: ${errorMessage(cause)}`)
            res.status(503).json({ ok: false })
        }
    })

    app.get('/', (_req, res) => {
        res.send(renderLandingPage(mcpUrl.href))
    })

    app.get('/privacy', (_req, res) => {
        res.send(renderPrivacyPage())
    })

    app.get('/support', (_req, res) => {
        res.send(renderSupportPage())
    })

    app.use(
        mcpAuthRouter({
            provider,
            issuerUrl: config.baseUrl,
            resourceServerUrl: mcpUrl,
            resourceName: 'standup-mr',
            serviceDocumentationUrl: new URL(
                'https://github.com/Jubstaaa/standup-mr'
            ),
            authorizationOptions: { rateLimit: authLimit },
            clientRegistrationOptions: { rateLimit: authLimit },
            tokenOptions: { rateLimit: authLimit },
            revocationOptions: { rateLimit: authLimit },
        })
    )

    app.use(
        '/connect',
        createConnectRouter({
            baseUrl: config.baseUrl,
            fetchImpl,
            freshAccessToken,
            githubAppSlug: config.githubAppSlug,
            hostCheck: services.hostCheck,
            now,
            store,
            upstream,
        })
    )

    const toolLimit = rateLimit({
        windowMs: 60_000,
        limit: MCP_CALLS_PER_MINUTE,
        keyGenerator: req =>
            String(req.auth?.extra?.connectionId ?? clientKey(req)),
        standardHeaders: 'draft-8',
        legacyHeaders: false,
    })

    // Stateless: every POST builds a server bound to the caller's connection,
    // so no MCP session has to survive a restart or live in memory.
    app.post(
        '/mcp',
        requireBearerAuth({
            verifier: provider,
            resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpUrl),
        }),
        toolLimit,
        express.json({ limit: '256kb' }),
        async (req, res) => {
            const server = createRemoteServer({
                connectionId: String(req.auth!.extra!.connectionId),
                fetchImpl,
                freshAccessToken,
                now,
                store,
            })
            const transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: undefined,
                enableJsonResponse: true,
            })
            res.on('close', () => {
                void transport.close()
                void server.close()
            })
            await server.connect(transport)
            await transport.handleRequest(req, res, req.body)
        }
    )

    app.all('/mcp', (_req, res) => {
        res.status(405)
            .set('Allow', 'POST')
            .json({
                jsonrpc: '2.0',
                error: { code: -32000, message: 'Method not allowed.' },
                id: null,
            })
    })

    return app
}
