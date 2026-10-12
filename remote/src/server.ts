import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js'
import {
    getOAuthProtectedResourceMetadataUrl,
    mcpAuthRouter,
} from '@modelcontextprotocol/sdk/server/auth/router.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import express from 'express'
import type { Express } from 'express'
import { rateLimit } from 'express-rate-limit'

import type { FetchLike } from '../../src/types/standup.types'

import { createConnectRouter } from './connect'
import { StandupOAuthProvider } from './oauth-provider'
import { clientKey } from './rate-limit'
import type { RemoteConfig } from './remote.types'
import { createHostGuard } from './ssrf'
import type { HostGuard } from './ssrf'
import type { Store } from './store'
import { createRemoteServer } from './tools'
import { upstreamApps } from './upstream'

export interface AppOptions {
    fetchImpl?: FetchLike
    guard?: HostGuard
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
    const fetchImpl = options.fetchImpl
    const guard = options.guard ?? createHostGuard(config.blockedAddresses)
    const provider = new StandupOAuthProvider(store, now)
    const mcpUrl = new URL('/mcp', config.baseUrl)
    const authLimit = { keyGenerator: clientKey }

    app.disable('x-powered-by')

    app.get('/health', (_req, res) => {
        res.json({ ok: true })
    })

    app.get('/', (_req, res) => {
        res.redirect(
            'https://github.com/Jubstaaa/standup-mr#claudeai-web-and-mobile'
        )
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
            baseUrl: config.baseUrl,
            fetchImpl,
            githubAppSlug: config.githubAppSlug,
            guard,
            now,
            store,
        })
    )

    const toolLimit = rateLimit({
        windowMs: 60_000,
        limit: 10,
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
                apps,
                connectionId: String(req.auth!.extra!.connectionId),
                fetchImpl,
                guard,
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
