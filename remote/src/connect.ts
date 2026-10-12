import { Router, urlencoded } from 'express'
import type { Request, Response } from 'express'
import { rateLimit } from 'express-rate-limit'

import { inferWebhookKind } from '../../src/notify/notify'
import type { FetchLike, ProviderKind } from '../../src/types/standup.types'

import { providerFor } from './accounts'
import { renderConnectPage, renderMessagePage } from './connect-page'
import { randomToken } from './crypto'
import { clientKey } from './rate-limit'
import type { PendingAuthorization } from './remote.types'
import type { HostGuard } from './ssrf'
import { HostError, normalizeHost } from './ssrf'
import type { Store } from './store'
import { CODE_TTL_MS } from './store.constants'
import { authorizationUrl, exchangeCode } from './upstream'
import type { UpstreamApp } from './upstream'

export interface ConnectDeps {
    apps: Partial<Record<ProviderKind, UpstreamApp>>
    baseUrl: URL
    fetchImpl?: FetchLike
    githubAppSlug?: string
    guard: HostGuard
    now: () => number
    store: Store
}

function isProviderKind(value: unknown): value is ProviderKind {
    return value === 'github' || value === 'gitlab'
}

function message(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

export function createConnectRouter(deps: ConnectDeps): Router {
    const { apps, store } = deps
    const router = Router()
    router.use(urlencoded({ extended: false, limit: '8kb' }))

    const callbackUrl = (kind: ProviderKind) =>
        new URL(`/connect/callback/${kind}`, deps.baseUrl).href

    const pageUrl = (pendingId: string, error?: string) =>
        `/connect/${encodeURIComponent(pendingId)}` +
        (error ? `?error=${encodeURIComponent(error)}` : '')

    function expired(res: Response) {
        res.status(410).send(
            renderMessagePage(
                'This link has expired',
                'Go back to Claude and press Connect again.'
            )
        )
    }

    function withPending(
        handler: (
            pending: PendingAuthorization,
            req: Request,
            res: Response
        ) => Promise<void> | void
    ) {
        return async (req: Request, res: Response) => {
            const pending = store.getPending(
                String(req.params.pendingId),
                deps.now()
            )
            if (!pending) return expired(res)
            await handler(pending, req, res)
        }
    }

    // Upstream callbacks come back with the pending id as `state`, so they
    // must be routed before the /:pendingId pages.
    router.get('/callback/:kind', async (req, res) => {
        const kind = req.params.kind
        const app = isProviderKind(kind) ? apps[kind] : undefined
        const state = typeof req.query.state === 'string' ? req.query.state : ''
        const code = typeof req.query.code === 'string' ? req.query.code : ''
        const pending = store.getPending(state, deps.now())
        if (!app || !pending) return expired(res)
        if (!code) {
            return res.redirect(
                pageUrl(pending.id, 'The sign-in was cancelled.')
            )
        }

        try {
            const tokens = await exchangeCode(
                app,
                code,
                callbackUrl(app.kind),
                deps.now(),
                deps.fetchImpl
            )
            const identity = await providerFor(
                app.kind,
                app.host,
                tokens.accessToken,
                deps.fetchImpl
            ).getIdentity()
            store.addAccount({
                connectionId: pending.connectionId,
                provider: app.kind,
                host: app.host,
                username: identity.username,
                source: 'oauth',
                ...tokens,
            })
            res.redirect(pageUrl(pending.id))
        } catch (error) {
            res.redirect(
                pageUrl(
                    pending.id,
                    `Could not link ${app.host}: ${message(error)}`
                )
            )
        }
    })

    router.get(
        '/:pendingId',
        withPending((pending, req, res) => {
            res.setHeader('Cache-Control', 'no-store')
            res.send(
                renderConnectPage({
                    pendingId: pending.id,
                    accounts: store.listAccounts(pending.connectionId),
                    webhook: store.getWebhook(pending.connectionId),
                    error:
                        typeof req.query.error === 'string'
                            ? req.query.error.slice(0, 300)
                            : undefined,
                    githubAvailable: Boolean(apps.github),
                    githubInstallUrl: deps.githubAppSlug
                        ? `https://github.com/apps/${deps.githubAppSlug}/installations/new`
                        : undefined,
                    gitlabAvailable: Boolean(apps.gitlab),
                })
            )
        })
    )

    router.get(
        '/:pendingId/link/:kind',
        withPending((pending, req, res) => {
            const kind = req.params.kind
            const app = isProviderKind(kind) ? apps[kind] : undefined
            if (!app) return void res.redirect(pageUrl(pending.id))
            res.redirect(
                authorizationUrl(app, callbackUrl(app.kind), pending.id)
            )
        })
    )

    // Validating a pasted token makes the server call a host the user
    // chose, so it gets a tighter per-IP limit than the rest of the page.
    const tokenLimit = rateLimit({
        windowMs: 60_000,
        limit: 10,
        keyGenerator: clientKey,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
    })

    router.post(
        '/:pendingId/token',
        tokenLimit,
        withPending(async (pending, req, res) => {
            const provider = req.body?.provider
            const token = String(req.body?.token ?? '').trim()
            if (!isProviderKind(provider) || !token) {
                return res.redirect(
                    pageUrl(
                        pending.id,
                        'Provider, host and token are required.'
                    )
                )
            }
            try {
                const host = normalizeHost(String(req.body?.host ?? ''))
                await deps.guard(host)
                const identity = await providerFor(
                    provider,
                    host,
                    token,
                    deps.fetchImpl
                ).getIdentity()
                store.addAccount({
                    connectionId: pending.connectionId,
                    provider,
                    host,
                    username: identity.username,
                    source: 'pat',
                    accessToken: token,
                    refreshToken: null,
                    expiresAt: null,
                })
                res.redirect(pageUrl(pending.id))
            } catch (error) {
                const text =
                    error instanceof HostError
                        ? error.message
                        : `The token was not accepted: ${message(error)}`
                res.redirect(pageUrl(pending.id, text))
            }
        })
    )

    router.post(
        '/:pendingId/accounts/:accountId/remove',
        withPending((pending, req, res) => {
            store.removeAccount(
                pending.connectionId,
                String(req.params.accountId)
            )
            res.redirect(pageUrl(pending.id))
        })
    )

    router.post(
        '/:pendingId/webhook',
        withPending((pending, req, res) => {
            const url = String(req.body?.url ?? '').trim()
            if (!url) {
                store.setWebhook(pending.connectionId, undefined)
                return res.redirect(pageUrl(pending.id))
            }
            // Only the known chat hosts: the server posts to this URL, so an
            // arbitrary one would let anyone aim it at any address.
            const kind = url.startsWith('https://')
                ? inferWebhookKind(url)
                : null
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
        })
    )

    router.post(
        '/:pendingId/finish',
        withPending((pending, _req, res) => {
            if (store.listAccounts(pending.connectionId).length === 0) {
                return res.redirect(
                    pageUrl(pending.id, 'Link at least one account first.')
                )
            }
            const code = randomToken()
            const now = deps.now()
            store.completePending(pending, code, now + CODE_TTL_MS, now)
            const target = new URL(pending.redirectUri)
            target.searchParams.set('code', code)
            if (pending.state) target.searchParams.set('state', pending.state)
            res.redirect(target.href)
        })
    )

    router.post(
        '/:pendingId/cancel',
        withPending((pending, _req, res) => {
            store.deleteConnection(pending.connectionId)
            const target = new URL(pending.redirectUri)
            target.searchParams.set('error', 'access_denied')
            if (pending.state) target.searchParams.set('state', pending.state)
            res.redirect(target.href)
        })
    )

    return router
}
