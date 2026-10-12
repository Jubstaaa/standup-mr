import cookieParser from 'cookie-parser'
import { Router, urlencoded } from 'express'
import type { Request, RequestHandler, Response } from 'express'
import { rateLimit } from 'express-rate-limit'

import { inferWebhookKind } from '../../../src/notify/notify'
import type { FetchLike, ProviderKind } from '../../../src/types/standup.types'
import { providerFor } from '../accounts/accounts'
import { randomToken } from '../crypto/crypto'
import { errorMessage } from '../errors/errors'
import { clientKey } from '../rate-limit/rate-limit'
import { HostError, normalizeHost } from '../ssrf/ssrf'
import type { HostCheck } from '../ssrf/ssrf'
import type { Store } from '../store/store'
import type { PendingAuthorization } from '../store/store.types'
import { appPath, callbackUrl } from '../upstream/upstream'
import type { Upstream } from '../upstream/upstream'
import { GITHUB_HOST, GITLAB_HOST } from '../upstream/upstream.constants'
import type { UpstreamTokens } from '../upstream/upstream.types'

import { renderConnectPage, renderMessagePage } from './connect-page'
import {
    CONNECT_COOKIE,
    ERROR_MESSAGE_MAX_LENGTH,
    TOKEN_FORM_LIMIT_PER_MINUTE,
} from './connect.constants'

export interface ConnectDeps {
    baseUrl: URL
    fetchImpl: FetchLike
    githubAppSlug?: string
    hostCheck: HostCheck
    now: () => number
    store: Store
    upstream: Upstream
}

interface PageParams {
    error?: string
    host?: string
    provider?: ProviderKind
}

type PendingHandler = (
    pending: PendingAuthorization,
    req: Request,
    res: Response
) => Promise<void> | void

function isProviderKind(value: unknown): value is ProviderKind {
    return value === 'github' || value === 'gitlab'
}

function field(req: Request, name: string): string {
    const value: unknown = req.body?.[name]
    return typeof value === 'string' ? value.trim() : ''
}

function browserSecret(req: Request): string | undefined {
    const value: unknown = req.cookies?.[CONNECT_COOKIE]
    return typeof value === 'string' ? value : undefined
}

function pageUrl(pendingId: string, params: PageParams = {}): string {
    const base = `/connect/${encodeURIComponent(pendingId)}`
    const query = new URLSearchParams(
        Object.entries(params).filter(([, value]) => value) as Array<
            [string, string]
        >
    ).toString()
    const anchor = params.host ? '#self-hosted' : ''
    return `${query ? `${base}?${query}` : base}${anchor}`
}

function defaultHost(kind: ProviderKind): string {
    return kind === 'github' ? GITHUB_HOST : GITLAB_HOST
}

function query(req: Request, name: string): string {
    const value = req.query[name]
    return typeof value === 'string' ? value : ''
}

// The host a self-hosted panel is open for, when the query names a valid one.
function chosenHost(
    req: Request
): { host: string; kind: ProviderKind } | undefined {
    const kind = query(req, 'provider')
    if (!isProviderKind(kind) || !query(req, 'host')) return undefined
    try {
        return { kind, host: normalizeHost(query(req, 'host')) }
    } catch {
        return undefined
    }
}

function setupUrl(kind: ProviderKind, host: string): string {
    return kind === 'github'
        ? `https://${host}/settings/applications/new`
        : `https://${host}/-/user_settings/applications`
}

function sendExpired(res: Response): void {
    res.status(410).send(
        renderMessagePage(
            'This link has expired',
            'Connect links work once, for 15 minutes, and only in the browser that started them. Go back to Claude and press Connect again.'
        )
    )
}

function redirectToClient(
    pending: PendingAuthorization,
    params: Record<string, string>
): string {
    const target = new URL(pending.redirectUri)
    for (const [name, value] of Object.entries(params)) {
        target.searchParams.set(name, value)
    }
    if (pending.state) target.searchParams.set('state', pending.state)
    return target.href
}

export function createConnectRouter(deps: ConnectDeps): Router {
    const { store, upstream } = deps
    const router = Router()
    router.use(cookieParser(), urlencoded({ extended: false, limit: '8kb' }))

    function withPending(handler: PendingHandler): RequestHandler {
        return async (req, res) => {
            const pending = store.getPending(
                String(req.params.pendingId),
                browserSecret(req),
                deps.now()
            )
            if (!pending) return sendExpired(res)
            // Already finished: answer a reload or a second click with the
            // redirect that carries the code, rather than losing it.
            if (pending.finishedRedirect) {
                return res.redirect(pending.finishedRedirect)
            }
            await handler(pending, req, res)
        }
    }

    function appForRoute(req: Request) {
        const { kind, host } = req.params
        if (!isProviderKind(kind)) return undefined
        return upstream.resolve(
            kind,
            typeof host === 'string' ? host : defaultHost(kind)
        )
    }

    async function linkAccount(
        pending: PendingAuthorization,
        kind: ProviderKind,
        host: string,
        tokens: UpstreamTokens,
        source: 'oauth' | 'pat'
    ): Promise<void> {
        const identity = await providerFor(
            kind,
            host,
            tokens.accessToken,
            deps.fetchImpl
        ).getIdentity()
        store.addAccount({
            connectionId: pending.connectionId,
            provider: kind,
            host,
            username: identity.username,
            source,
            ...tokens,
        })
    }

    const showPage: PendingHandler = (pending, req, res) => {
        const client = store.getClient(pending.clientId)
        const chosen = chosenHost(req)
        const app = chosen
            ? upstream.resolve(chosen.kind, chosen.host)
            : undefined
        res.setHeader('Cache-Control', 'no-store')
        res.send(
            renderConnectPage({
                pendingId: pending.id,
                clientName: client?.client_name ?? 'An MCP client',
                redirectHost: new URL(pending.redirectUri).host,
                accounts: store.listAccounts(pending.connectionId),
                webhook: store.getWebhook(pending.connectionId),
                error: query(req, 'error').slice(0, ERROR_MESSAGE_MAX_LENGTH),
                providers: upstream.builtIn.map(builtIn => ({
                    kind: builtIn.kind,
                    host: builtIn.host,
                    href: `${pageUrl(pending.id)}/link/${appPath(builtIn.kind, builtIn.host)}`,
                })),
                githubInstallUrl: deps.githubAppSlug
                    ? `https://github.com/apps/${deps.githubAppSlug}/installations/new`
                    : undefined,
                selfHosted: chosen && {
                    ...chosen,
                    signInHref: app
                        ? `${pageUrl(pending.id)}/link/${appPath(chosen.kind, chosen.host)}`
                        : undefined,
                    canSetUp: !app || (app.isInstance && !app.isVerified),
                    callbackUrl: callbackUrl(
                        deps.baseUrl,
                        chosen.kind,
                        chosen.host
                    ),
                    setupUrl: setupUrl(chosen.kind, chosen.host),
                },
            })
        )
    }

    // The upstream round trip gets its own single-use state instead of the
    // page id, so the page id never leaves this site.
    const startUpstreamLogin: PendingHandler = async (pending, req, res) => {
        const app = appForRoute(req)
        if (!app) return res.redirect(pageUrl(pending.id))
        const state = randomToken()
        const codeVerifier = randomToken()
        store.setUpstreamLogin(pending, state, codeVerifier)
        res.redirect(await upstream.authorizationUrl(app, state, codeVerifier))
    }

    const finishUpstreamLogin: RequestHandler = async (req, res) => {
        const app = appForRoute(req)
        const state = query(req, 'state')
        const login = state
            ? store.takeUpstreamLogin(state, browserSecret(req), deps.now())
            : undefined
        if (!app || !login || login.pending.finishedRedirect) {
            return sendExpired(res)
        }
        const { pending } = login
        const panel = app.isInstance
            ? { provider: app.kind, host: app.host }
            : {}
        if (!query(req, 'code')) {
            return res.redirect(
                pageUrl(pending.id, {
                    ...panel,
                    error:
                        query(req, 'error_description') ||
                        'The sign-in was cancelled.',
                })
            )
        }
        try {
            const tokens = await upstream.exchangeCode(
                app,
                new URL(req.originalUrl, deps.baseUrl),
                state,
                login.codeVerifier,
                deps.now()
            )
            await linkAccount(pending, app.kind, app.host, tokens, 'oauth')
            if (app.isInstance) {
                store.markInstanceVerified(app.kind, app.host, deps.now())
            }
            res.redirect(pageUrl(pending.id))
        } catch (error) {
            const hint = app.isInstance
                ? ' Check the application ID, secret and redirect URI registered on that host.'
                : ''
            res.redirect(
                pageUrl(pending.id, {
                    ...panel,
                    error: `Could not sign in to ${app.host}: ${errorMessage(error).replace(/\.$/, '')}.${hint}`,
                })
            )
        }
    }

    const chooseHost: PendingHandler = async (pending, req, res) => {
        const provider = field(req, 'provider')
        if (!isProviderKind(provider)) return res.redirect(pageUrl(pending.id))
        try {
            const host = normalizeHost(field(req, 'host'))
            await deps.hostCheck(host)
            res.redirect(pageUrl(pending.id, { provider, host }))
        } catch (error) {
            res.redirect(pageUrl(pending.id, { error: errorMessage(error) }))
        }
    }

    const registerInstance: PendingHandler = async (pending, req, res) => {
        const provider = field(req, 'provider')
        const clientId = field(req, 'client_id')
        const clientSecret = field(req, 'client_secret')
        if (!isProviderKind(provider)) return res.redirect(pageUrl(pending.id))
        let host = ''
        try {
            host = normalizeHost(field(req, 'host'))
            if (!clientId || !clientSecret) {
                throw new HostError(
                    'Both the application ID and the secret are required.'
                )
            }
            if (host === defaultHost(provider)) {
                throw new HostError(
                    `${host} already has a sign-in button above.`
                )
            }
            await deps.hostCheck(host)
            const saved = store.saveInstance(
                { kind: provider, host, clientId, clientSecret },
                deps.now()
            )
            if (!saved) {
                throw new HostError(
                    `Sign-in for ${host} is already set up. Use the sign-in button.`
                )
            }
            res.redirect(
                `${pageUrl(pending.id)}/link/${appPath(provider, host)}`
            )
        } catch (error) {
            res.redirect(
                pageUrl(pending.id, {
                    error: errorMessage(error),
                    provider,
                    host,
                })
            )
        }
    }

    const addPastedToken: PendingHandler = async (pending, req, res) => {
        const provider = field(req, 'provider')
        const token = field(req, 'token')
        if (!isProviderKind(provider) || !token) {
            return res.redirect(
                pageUrl(pending.id, {
                    error: 'Provider, host and token are required.',
                })
            )
        }
        try {
            const host = normalizeHost(field(req, 'host'))
            await deps.hostCheck(host)
            await linkAccount(
                pending,
                provider,
                host,
                { accessToken: token, refreshToken: null, expiresAt: null },
                'pat'
            )
            res.redirect(pageUrl(pending.id))
        } catch (error) {
            const text =
                error instanceof HostError
                    ? error.message
                    : `The token was not accepted: ${errorMessage(error)}`
            res.redirect(
                pageUrl(pending.id, {
                    error: text,
                    provider,
                    host: field(req, 'host'),
                })
            )
        }
    }

    const removeAccount: PendingHandler = (pending, req, res) => {
        store.removeAccount(pending.connectionId, String(req.params.accountId))
        res.redirect(pageUrl(pending.id))
    }

    const saveWebhook: PendingHandler = (pending, req, res) => {
        const url = field(req, 'url')
        if (!url) {
            store.setWebhook(pending.connectionId, undefined)
            return res.redirect(pageUrl(pending.id))
        }
        // Only the known chat hosts: the server posts to this URL, so an
        // arbitrary one would let anyone aim it at any address.
        const kind = url.startsWith('https://') ? inferWebhookKind(url) : null
        if (!kind) {
            return res.redirect(
                pageUrl(pending.id, {
                    error: 'Use a Slack, Discord or Google Chat webhook URL (https).',
                })
            )
        }
        store.setWebhook(pending.connectionId, { kind, url })
        res.redirect(pageUrl(pending.id))
    }

    const finish: PendingHandler = (pending, _req, res) => {
        if (store.listAccounts(pending.connectionId).length === 0) {
            return res.redirect(
                pageUrl(pending.id, {
                    error: 'Link at least one account first.',
                })
            )
        }
        const code = randomToken()
        const redirect = redirectToClient(pending, { code })
        store.completePending(pending, code, redirect, deps.now())
        res.redirect(redirect)
    }

    const cancel: PendingHandler = (pending, _req, res) => {
        store.deleteConnection(pending.connectionId)
        res.redirect(redirectToClient(pending, { error: 'access_denied' }))
    }

    // Validating a pasted token makes the server call a host the user
    // chose, so it gets a tighter per-IP limit than the rest of the page.
    const tokenLimit = rateLimit({
        windowMs: 60_000,
        limit: TOKEN_FORM_LIMIT_PER_MINUTE,
        keyGenerator: clientKey,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
    })

    // Registered before /:pendingId, which would otherwise match "callback".
    router.get('/callback/:kind{/:host}', finishUpstreamLogin)
    router.get('/:pendingId', withPending(showPage))
    router.get(
        '/:pendingId/link/:kind{/:host}',
        withPending(startUpstreamLogin)
    )
    router.post('/:pendingId/self-hosted', tokenLimit, withPending(chooseHost))
    router.post(
        '/:pendingId/instances',
        tokenLimit,
        withPending(registerInstance)
    )
    router.post('/:pendingId/token', tokenLimit, withPending(addPastedToken))
    router.post(
        '/:pendingId/accounts/:accountId/remove',
        withPending(removeAccount)
    )
    router.post('/:pendingId/webhook', withPending(saveWebhook))
    router.post('/:pendingId/finish', withPending(finish))
    router.post('/:pendingId/cancel', withPending(cancel))

    return router
}
