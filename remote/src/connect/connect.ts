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
import { toUpstreamTokens } from '../upstream/upstream'
import type { UpstreamApps } from '../upstream/upstream'
import type { UpstreamTokens } from '../upstream/upstream.types'

import { renderConnectPage, renderMessagePage } from './connect-page'
import {
    CONNECT_COOKIE,
    ERROR_MESSAGE_MAX_LENGTH,
    TOKEN_FORM_LIMIT_PER_MINUTE,
} from './connect.constants'

export interface ConnectDeps {
    apps: UpstreamApps
    fetchImpl: FetchLike
    githubAppSlug?: string
    hostCheck: HostCheck
    now: () => number
    store: Store
}

type PendingHandler = (
    pending: PendingAuthorization,
    req: Request,
    res: Response
) => Promise<void> | void

function isProviderKind(value: unknown): value is ProviderKind {
    return value === 'github' || value === 'gitlab'
}

function appForRoute(apps: UpstreamApps, req: Request) {
    const { kind, host } = req.params
    const path = host ? `${kind}/${host}` : kind
    return apps.find(app => app.path === path)
}

function field(req: Request, name: string): string {
    const value: unknown = req.body?.[name]
    return typeof value === 'string' ? value.trim() : ''
}

function browserSecret(req: Request): string | undefined {
    const value: unknown = req.cookies?.[CONNECT_COOKIE]
    return typeof value === 'string' ? value : undefined
}

function pageUrl(pendingId: string, error?: string): string {
    const base = `/connect/${encodeURIComponent(pendingId)}`
    return error ? `${base}?error=${encodeURIComponent(error)}` : base
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
    const { apps, store } = deps
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
        const error =
            typeof req.query.error === 'string'
                ? req.query.error.slice(0, ERROR_MESSAGE_MAX_LENGTH)
                : undefined
        res.setHeader('Cache-Control', 'no-store')
        res.send(
            renderConnectPage({
                pendingId: pending.id,
                clientName: client?.client_name ?? 'An MCP client',
                redirectHost: new URL(pending.redirectUri).host,
                accounts: store.listAccounts(pending.connectionId),
                webhook: store.getWebhook(pending.connectionId),
                error,
                providers: apps.map(app => ({
                    kind: app.kind,
                    host: app.host,
                    href: `${pageUrl(pending.id)}/link/${app.path}`,
                })),
                githubInstallUrl: deps.githubAppSlug
                    ? `https://github.com/apps/${deps.githubAppSlug}/installations/new`
                    : undefined,
            })
        )
    }

    // The upstream round trip gets its own single-use state instead of the
    // page id, so the page id never leaves this site.
    const startUpstreamLogin: PendingHandler = (pending, req, res) => {
        const app = appForRoute(apps, req)
        if (!app) return res.redirect(pageUrl(pending.id))
        const state = randomToken()
        store.setUpstreamState(pending, state)
        res.redirect(app.client.createAuthorizationURL(state, app.scopes).href)
    }

    const finishUpstreamLogin: RequestHandler = async (req, res) => {
        const app = appForRoute(apps, req)
        const state = typeof req.query.state === 'string' ? req.query.state : ''
        const code = typeof req.query.code === 'string' ? req.query.code : ''
        const pending = state
            ? store.takePendingByUpstreamState(
                  state,
                  browserSecret(req),
                  deps.now()
              )
            : undefined
        if (!app || !pending || pending.finishedRedirect) {
            return sendExpired(res)
        }
        if (!code) {
            return res.redirect(
                pageUrl(pending.id, 'The sign-in was cancelled.')
            )
        }
        try {
            const tokens = toUpstreamTokens(
                await app.client.validateAuthorizationCode(code)
            )
            await linkAccount(pending, app.kind, app.host, tokens, 'oauth')
            res.redirect(pageUrl(pending.id))
        } catch (error) {
            res.redirect(
                pageUrl(
                    pending.id,
                    `Could not link ${app.host}: ${errorMessage(error)}`
                )
            )
        }
    }

    const addPastedToken: PendingHandler = async (pending, req, res) => {
        const provider = field(req, 'provider')
        const token = field(req, 'token')
        if (!isProviderKind(provider) || !token) {
            return res.redirect(
                pageUrl(pending.id, 'Provider, host and token are required.')
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
            res.redirect(pageUrl(pending.id, text))
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
                pageUrl(
                    pending.id,
                    'Use a Slack, Discord or Google Chat webhook URL (https).'
                )
            )
        }
        store.setWebhook(pending.connectionId, { kind, url })
        res.redirect(pageUrl(pending.id))
    }

    const finish: PendingHandler = (pending, _req, res) => {
        if (store.listAccounts(pending.connectionId).length === 0) {
            return res.redirect(
                pageUrl(pending.id, 'Link at least one account first.')
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
