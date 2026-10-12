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

import type { FetchLike } from '../../../src/types/standup.types'
import { createTokenRefresher } from '../accounts/accounts'
import type { RemoteConfig } from '../config/config.types'
import { createConnectRouter } from '../connect/connect'
import { renderLandingPage } from '../connect/connect-page'
import { StandupOAuthProvider } from '../oauth/oauth'
import { clientKey } from '../rate-limit/rate-limit'
import {
    blockedSet,
    createGuardedFetch,
    createGuardedLookup,
    createHostCheck,
} from '../ssrf/ssrf'
import type { Lookup } from '../ssrf/ssrf'
import type { Store } from '../store/store'
import { createRemoteServer } from '../tools/tools'
import { upstreamApps } from '../upstream/upstream'

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

export function createApp(
    config: RemoteConfig,
    store: Store,
    options: AppOptions = {}
): Express {
    const app = express()
    const apps = upstreamApps(config)
    const now = options.now ?? Date.now
    const blocked = blockedSet(config.blockedAddresses)
    const lookup = createGuardedLookup(blocked, options.lookup)
    const fetchImpl = options.fetchImpl ?? createGuardedFetch(lookup, blocked)
    const freshAccessToken = createTokenRefresher(apps, store)
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

    app.get('/health', (_req, res) => {
        res.json({ ok: true })
    })

    app.get('/', (_req, res) => {
        res.send(renderLandingPage(mcpUrl.href))
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
            apps,
            fetchImpl,
            githubAppSlug: config.githubAppSlug,
            hostCheck: createHostCheck(lookup),
            now,
            store,
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
