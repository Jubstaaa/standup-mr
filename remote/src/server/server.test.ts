import { createHash, randomBytes } from 'node:crypto'
import type { Server } from 'node:http'

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import type { RemoteConfig } from '../config/config.types'
import { Store } from '../store/store'

import { createApp } from './server'

const REDIRECT_URI = 'https://claude.ai/api/mcp/auth_callback'
const verifier = randomBytes(32).toString('base64url')
const challenge = createHash('sha256').update(verifier).digest('base64url')

let base: string
let server: Server
let store: Store

const tokenRequests: URLSearchParams[] = []

// Stands in for git.example.com: its user endpoint and OAuth token endpoint.
const fakeUpstream = async (url: string, init?: RequestInit) => {
    if (url.endsWith('/api/v4/user')) {
        return Response.json({ id: 1, username: 'ilker' })
    }
    if (url === 'https://git.example.com/oauth/token') {
        tokenRequests.push(new URLSearchParams(String(init?.body)))
        return Response.json({
            access_token: 'gitlab-oauth-token',
            token_type: 'Bearer',
            refresh_token: 'gitlab-refresh',
            expires_in: 7200,
        })
    }
    return new Response('not found', { status: 404 })
}

beforeAll(async () => {
    const config: RemoteConfig = {
        baseUrl: new URL('http://localhost'),
        blockedAddresses: [],
        databasePath: ':memory:',
        encryptionKey: randomBytes(32),
        port: 0,
    }
    store = new Store(':memory:', config.encryptionKey)
    const app = createApp(config, store, {
        fetchImpl: fakeUpstream,
        lookup: (_host, _options, callback) =>
            callback(null, [{ address: '140.82.112.3', family: 4 }]),
    })
    server = await new Promise<Server>(resolve => {
        const listening = app.listen(0, () => resolve(listening))
    })
    const address = server.address()
    base = `http://127.0.0.1:${typeof address === 'object' ? address?.port : 0}`
})

afterAll(() => {
    server.close()
    store.close()
})

let cookie = ''

// The browser that started the flow: sends the connect cookie back.
function browser(path: string, init: RequestInit = {}) {
    return fetch(`${base}${path}`, {
        redirect: 'manual',
        ...init,
        headers: { ...init.headers, Cookie: cookie },
    })
}

function form(body: Record<string, string>): RequestInit {
    return {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(body).toString(),
    }
}

function rpc(token: string | null, body: object) {
    return fetch(`${base}/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/event-stream',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
    })
}

describe('claude.ai connect flow', () => {
    let clientId: string
    let pagePath: string
    let accessToken: string

    test('advertises OAuth metadata', async () => {
        const response = await fetch(
            `${base}/.well-known/oauth-authorization-server`
        )
        const metadata = (await response.json()) as Record<string, unknown>
        expect(metadata.registration_endpoint).toBeTruthy()
        expect(metadata.code_challenge_methods_supported).toEqual(['S256'])
    })

    test('rejects /mcp without a token and points to the metadata', async () => {
        const response = await rpc(null, {
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/list',
        })
        expect(response.status).toBe(401)
        expect(response.headers.get('www-authenticate')).toContain(
            'resource_metadata'
        )
    })

    test('registers a client dynamically', async () => {
        const response = await fetch(`${base}/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                redirect_uris: [REDIRECT_URI],
                token_endpoint_auth_method: 'none',
                client_name: 'Claude',
            }),
        })
        expect(response.status).toBe(201)
        clientId = ((await response.json()) as { client_id: string }).client_id
    })

    test('authorize sends the user to the connect page', async () => {
        const url = new URL(`${base}/authorize`)
        url.search = new URLSearchParams({
            response_type: 'code',
            client_id: clientId,
            redirect_uri: REDIRECT_URI,
            code_challenge: challenge,
            code_challenge_method: 'S256',
            state: 'st',
        }).toString()
        const response = await fetch(url, { redirect: 'manual' })
        expect(response.status).toBe(302)
        pagePath = response.headers.get('location')!
        expect(pagePath).toStartWith('/connect/')
        cookie = response.headers.get('set-cookie')!.split(';')[0]!

        const page = await (await browser(pagePath)).text()
        expect(page).toContain('No account linked yet')
        expect(page).toContain('Connect standup-mr to Claude')
        expect(page).toContain('<strong>claude.ai</strong>')
    })

    test('a forwarded link is useless in another browser', async () => {
        const page = await fetch(`${base}${pagePath}`)
        expect(page.status).toBe(410)
        const finish = await fetch(`${base}${pagePath}/finish`, {
            ...form({}),
            redirect: 'manual',
        })
        expect(finish.status).toBe(410)
    })

    test('publishes a privacy policy and a support page', async () => {
        for (const path of ['/privacy', '/support']) {
            const response = await fetch(`${base}${path}`)
            expect(response.status).toBe(200)
            expect(await response.text()).toContain('ilkerbalcilartr@gmail.com')
        }
    })

    test('serves the project icon to other sites', async () => {
        const response = await fetch(`${base}/favicon.ico`)
        expect(response.status).toBe(200)
        expect(response.headers.get('content-type')).toBe('image/png')
        expect(response.headers.get('cross-origin-resource-policy')).toBeNull()
    })

    test('sends security headers', async () => {
        const response = await browser(pagePath)
        expect(response.headers.get('content-security-policy')).toContain(
            "frame-ancestors 'none'"
        )
        expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    })

    test('finish is refused until an account is linked', async () => {
        const response = await browser(`${pagePath}/finish`, form({}))
        expect(response.headers.get('location')).toContain('error=')
    })

    test('a pasted self-hosted token is validated and listed', async () => {
        const response = await browser(
            `${pagePath}/token`,
            form({
                provider: 'gitlab',
                host: 'https://git.example.com/',
                token: 'glpat-x',
            })
        )
        expect(response.headers.get('location')).toBe(pagePath)
        const page = await (await browser(pagePath)).text()
        expect(page).toContain(
            '<strong>ilker</strong><span>git.example.com</span>'
        )
        expect(page).not.toContain('glpat-x')
    })

    test('a self-hosted GitLab is set up once and then signed in to', async () => {
        const chosen = await browser(
            `${pagePath}/self-hosted`,
            form({ provider: 'gitlab', host: 'https://git.example.com/' })
        )
        const panelPath = chosen.headers.get('location')!
        expect(panelPath).toContain('host=git.example.com')

        const panel = await (await browser(panelPath)).text()
        expect(panel).toContain("git.example.com isn't set up for sign-in yet")
        expect(panel).toContain(
            'http://localhost/connect/callback/gitlab/git.example.com'
        )

        const saved = await browser(
            `${pagePath}/instances`,
            form({
                provider: 'gitlab',
                host: 'git.example.com',
                client_id: 'company-app',
                client_secret: 'company-secret',
            })
        )
        const linkPath = saved.headers.get('location')!
        expect(linkPath).toEndWith('/link/gitlab/git.example.com')

        const link = await browser(linkPath)
        const authorize = new URL(link.headers.get('location')!)
        expect(authorize.origin + authorize.pathname).toBe(
            'https://git.example.com/oauth/authorize'
        )
        expect(authorize.searchParams.get('client_id')).toBe('company-app')
        expect(authorize.searchParams.get('code_challenge_method')).toBe('S256')

        const callback = await browser(
            `/connect/callback/gitlab/git.example.com?code=granted&state=${authorize.searchParams.get('state')}`
        )
        expect(callback.headers.get('location')).toBe(pagePath)
        expect(tokenRequests[0]!.get('client_secret')).toBe('company-secret')
        expect(tokenRequests[0]!.get('code_verifier')).toBeTruthy()
        const [account] = store
            .listAccounts(
                store.getPending(
                    pagePath.split('/').pop()!,
                    cookie.split('=')[1],
                    Date.now()
                )!.connectionId
            )
            .filter(linked => linked.host === 'git.example.com')
        expect(account?.source).toBe('oauth')
        expect(account?.accessToken).toBe('gitlab-oauth-token')
    })

    test('a working instance cannot be replaced from the page', async () => {
        const panel = await (
            await browser(`${pagePath}?provider=gitlab&host=git.example.com`)
        ).text()
        expect(panel).toContain('Sign in with git.example.com')
        expect(panel).not.toContain('Set up sign-in for everyone')

        const takeover = await browser(
            `${pagePath}/instances`,
            form({
                provider: 'gitlab',
                host: 'git.example.com',
                client_id: 'attacker-app',
                client_secret: 'attacker-secret',
            })
        )
        expect(takeover.headers.get('location')).toContain('already+set+up')
        expect(store.getInstance('gitlab', 'git.example.com')?.clientId).toBe(
            'company-app'
        )
    })

    test('an unknown webhook host is refused', async () => {
        const response = await browser(
            `${pagePath}/webhook`,
            form({ url: 'https://evil.example.com/hook' })
        )
        expect(response.headers.get('location')).toContain('error=')
    })

    test('finish returns a code to claude.ai with the state', async () => {
        const response = await browser(`${pagePath}/finish`, form({}))
        const location = new URL(response.headers.get('location')!)

        const doubleClick = await browser(`${pagePath}/finish`, form({}))
        expect(doubleClick.headers.get('location')).toBe(location.href)

        expect(location.origin + location.pathname).toBe(REDIRECT_URI)
        expect(location.searchParams.get('state')).toBe('st')

        const token = await fetch(`${base}/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                code: location.searchParams.get('code')!,
                code_verifier: verifier,
                client_id: clientId,
                redirect_uri: REDIRECT_URI,
            }).toString(),
        })
        expect(token.status).toBe(200)
        accessToken = ((await token.json()) as { access_token: string })
            .access_token
    })

    test('the finished page only sends the user back to the client', async () => {
        const response = await browser(pagePath)
        expect(response.status).toBe(302)
        expect(response.headers.get('location')).toStartWith(REDIRECT_URI)
    })

    test('lists the three tools with the token', async () => {
        const response = await rpc(accessToken, {
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/list',
        })
        const body = (await response.json()) as {
            result: { tools: Array<{ name: string; title?: string }> }
        }
        expect(body.result.tools.every(tool => tool.title)).toBe(true)
        expect(body.result.tools.map(tool => tool.name).sort()).toEqual([
            'get_note_instructions',
            'get_standup_data',
            'post_standup_note',
        ])
    })

    test('post without a saved webhook explains how to add one', async () => {
        const response = await rpc(accessToken, {
            jsonrpc: '2.0',
            id: 3,
            method: 'tools/call',
            params: { name: 'post_standup_note', arguments: { text: 'hi' } },
        })
        const body = (await response.json()) as {
            result: { content: Array<{ text: string }>; isError: boolean }
        }
        expect(body.result.isError).toBe(true)
        expect(body.result.content[0]!.text).toContain('No webhook is saved')
    })
})
