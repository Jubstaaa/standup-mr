import escapeHtml from 'escape-html'

import type { ProviderKind } from '../../../src/types/standup.types'
import type { Account } from '../accounts/accounts.types'
import type { Webhook } from '../store/store.types'
import { GITHUB_HOST } from '../upstream/upstream.constants'

import { PAGE_STYLE } from './connect-page.constants'
import {
    CHECK_ICON,
    CLAUDE_ICON,
    CROSS_ICON,
    LOCK_ICON,
    MERGE_LINE,
    PROVIDER_ICONS,
} from './connect-page.icons'

export interface ProviderLink {
    host: string
    href: string
    kind: ProviderKind
}

// The self-hosted panel, open once someone has typed a host.
export interface SelfHostedPanel {
    callbackUrl: string
    canSetUp: boolean
    host: string
    kind: ProviderKind
    setupUrl: string
    signInHref?: string
}

export interface ConnectPageModel {
    accounts: Account[]
    clientName: string
    error?: string
    githubInstallUrl?: string
    pendingId: string
    providers: ProviderLink[]
    redirectHost: string
    selfHosted?: SelfHostedPanel
    webhook?: Webhook
}

export const SOURCE_URL = 'https://github.com/Jubstaaa/standup-mr'

const WEBHOOK_NAMES: Record<Webhook['kind'], string> = {
    'slack': 'Slack',
    'discord': 'Discord',
    'google-chat': 'Google Chat',
}

export function renderDocument(title: string, body: string): string {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/icon.png" type="image/png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<style>${PAGE_STYLE}</style>
</head>
<body>
<main class="sheet">${body}</main>
</body>
</html>`
}

function clientTile(clientName: string): string {
    const mark = /claude/i.test(clientName)
        ? CLAUDE_ICON
        : `<span class="monogram">${escapeHtml(clientName.slice(0, 1).toUpperCase())}</span>`
    return `<span class="tile tile-client" title="${escapeHtml(clientName)}">${mark}</span>`
}

function lockup(clientName: string): string {
    return `<div class="lockup" aria-hidden="true">
        ${clientTile(clientName)}
        ${MERGE_LINE}
        <span class="tile tile-standup"><img src="/icon.png" alt="" width="56" height="56"></span>
    </div>`
}

function scopeList(): string {
    return `<ul class="scope" aria-label="What standup-mr can do">
        <li class="can">${CHECK_ICON}<span>Read your merge requests, reviews and pipeline logs</span></li>
        <li class="can">${CHECK_ICON}<span>Post your note to a chat channel, only when you ask</span></li>
        <li class="cannot">${CROSS_ICON}<span>Push code, comment, approve or change anything</span></li>
    </ul>`
}

function accountRows(base: string, accounts: Account[]): string {
    if (accounts.length === 0) {
        return '<p class="empty">No account linked yet. Link at least one to continue.</p>'
    }
    const rows = accounts
        .map(
            account => `<li class="account">
            <span class="account-mark">${PROVIDER_ICONS[account.provider]}</span>
            <span class="account-name"><strong>${escapeHtml(account.username)}</strong><span>${escapeHtml(account.host)}</span></span>
            <form method="post" action="${base}/accounts/${encodeURIComponent(account.id)}/remove">
                <button class="quiet" type="submit" aria-label="Remove ${escapeHtml(account.username)} on ${escapeHtml(account.host)}">Remove</button>
            </form>
        </li>`
        )
        .join('')
    return `<ul class="accounts">${rows}</ul>`
}

function providerButtons(model: ConnectPageModel): string {
    if (model.providers.length === 0) return ''
    const buttons = model.providers
        .map(link => {
            const label =
                link.host === GITHUB_HOST ? 'GitHub' : escapeHtml(link.host)
            return `<a class="provider" href="${escapeHtml(link.href)}">${PROVIDER_ICONS[link.kind]}<span>Link a ${label} account</span></a>`
        })
        .join('')
    return `<div class="providers">${buttons}</div>`
}

function githubHint(model: ConnectPageModel): string {
    const hasGithub = model.providers.some(link => link.kind === 'github')
    if (!hasGithub || !model.githubInstallUrl) return ''
    return `<p class="hint">Org repositories missing? <a href="${escapeHtml(model.githubInstallUrl)}" target="_blank" rel="noopener">Install the GitHub App on your org</a>, or add github.com as a host below with a fine-grained token.</p>`
}

function hostFields(panel?: SelfHostedPanel): string {
    const kind = panel?.kind ?? 'gitlab'
    return `<label>Provider
        <select name="provider">
            <option value="gitlab"${kind === 'gitlab' ? ' selected' : ''}>GitLab</option>
            <option value="github"${kind === 'github' ? ' selected' : ''}>GitHub Enterprise</option>
        </select>
    </label>
    <label>Host <input name="host" value="${escapeHtml(panel?.host ?? '')}" placeholder="gitlab.example.com" required autocomplete="off" autocapitalize="off" spellcheck="false"></label>`
}

function hiddenHost(panel: SelfHostedPanel): string {
    return `<input type="hidden" name="provider" value="${panel.kind}"><input type="hidden" name="host" value="${escapeHtml(panel.host)}">`
}

function setupSteps(base: string, panel: SelfHostedPanel): string {
    const host = escapeHtml(panel.host)
    const scopes =
        panel.kind === 'github'
            ? '<code>repo</code> and <code>read:user</code>. GitHub has no read-only scope for private pull requests, so <code>repo</code> is the narrowest that works.'
            : '<code>read_api</code> and <code>read_user</code>, and tick Confidential.'
    return `<div class="setup">
        <h3>Set up sign-in for everyone at ${host}</h3>
        <ol class="steps">
            <li><a href="${escapeHtml(panel.setupUrl)}" target="_blank" rel="noopener">Create an OAuth application on ${host}</a>. Anyone with an account can; an admin can make it trusted.</li>
            <li>Use this redirect URI: <code class="copy">${escapeHtml(panel.callbackUrl)}</code></li>
            <li>Scopes: ${scopes}</li>
            <li>Paste the application ID and secret here. Once someone signs in with it, it is locked and shared by everyone at ${host}.</li>
        </ol>
        <form method="post" action="${base}/instances" class="fields">
            ${hiddenHost(panel)}
            <label>Application ID <input name="client_id" required autocomplete="off" spellcheck="false"></label>
            <label>Secret <input name="client_secret" type="password" required autocomplete="off"></label>
            <button class="secondary" type="submit">Save and sign in</button>
        </form>
    </div>`
}

function tokenOption(base: string, panel: SelfHostedPanel): string {
    const scope =
        panel.kind === 'github'
            ? 'read access to pull requests, actions and checks'
            : '<code>read_api</code>'
    return `<details class="nested">
        <summary>Or paste a personal access token</summary>
        <form method="post" action="${base}/token" class="fields">
            ${hiddenHost(panel)}
            <p class="hint">A read-only token is enough: ${scope}.</p>
            <label>Token <input name="token" type="password" required autocomplete="off"></label>
            <button class="secondary" type="submit">Add account</button>
        </form>
    </details>`
}

function selfHostedPanel(base: string, panel: SelfHostedPanel): string {
    const host = escapeHtml(panel.host)
    const signIn = panel.signInHref
        ? `<a class="provider" href="${escapeHtml(panel.signInHref)}">${PROVIDER_ICONS[panel.kind]}<span>Sign in with ${host}</span></a>`
        : `<p class="hint">${host} isn't set up for sign-in yet.</p>`
    return `<div class="panel">
        ${signIn}
        ${panel.canSetUp ? setupSteps(base, panel) : ''}
        ${tokenOption(base, panel)}
        <a class="quiet" href="${base}">Use a different host</a>
    </div>`
}

function selfHostedSection(base: string, panel?: SelfHostedPanel): string {
    const body = panel
        ? selfHostedPanel(base, panel)
        : `<form method="post" action="${base}/self-hosted" class="fields">
            <p class="hint">Your company's GitLab or GitHub Enterprise. If someone there already set up sign-in, you can use it; otherwise set it up once, or paste a token.</p>
            ${hostFields()}
            <button class="secondary" type="submit">Continue</button>
        </form>`
    return `<details class="disclosure" id="self-hosted"${panel ? ' open' : ''}>
        <summary>Your company's GitLab or GitHub Enterprise</summary>
        <div class="fields">${body}</div>
    </details>`
}

function webhookForm(base: string, webhook?: Webhook): string {
    const saved = webhook
        ? `<p class="saved">Notes go to a ${WEBHOOK_NAMES[webhook.kind]} channel (${escapeHtml(new URL(webhook.url).host)}).</p>`
        : ''
    const remove = webhook
        ? `<form method="post" action="${base}/webhook"><input type="hidden" name="url" value=""><button class="quiet" type="submit">Stop posting to this channel</button></form>`
        : ''
    return `<details class="disclosure disclosure-last"${webhook ? ' open' : ''}>
        <summary>Post notes to a chat channel <span class="optional">Optional</span></summary>
        <div class="fields">
            <p class="hint">Paste a Slack, Discord or Google Chat webhook. Claude posts there only when you ask it to.</p>
            ${saved}
            <form method="post" action="${base}/webhook" class="fields">
                <label>Webhook URL <input name="url" type="password" placeholder="https://hooks.slack.com/services/…" autocomplete="off"></label>
                <button class="secondary" type="submit">${webhook ? 'Replace webhook' : 'Save webhook'}</button>
            </form>
            ${remove}
        </div>
    </details>`
}

export function renderConnectPage(model: ConnectPageModel): string {
    const base = `/connect/${encodeURIComponent(model.pendingId)}`
    const client = escapeHtml(model.clientName)
    const canFinish = model.accounts.length > 0

    return renderDocument(
        `Connect standup-mr to ${model.clientName}`,
        `${lockup(model.clientName)}
        <h1>Connect standup-mr to ${client}</h1>
        <p class="lede">${client} will read your merge requests to write your standup.</p>
        <p class="return">You'll return to <strong>${escapeHtml(model.redirectHost)}</strong>. Didn't start this there? Close this page.</p>
        ${model.error ? `<p class="error" role="alert">${escapeHtml(model.error)}</p>` : ''}
        ${scopeList()}
        <section class="block" aria-labelledby="accounts-title">
            <h2 id="accounts-title">Accounts</h2>
            ${accountRows(base, model.accounts)}
            ${providerButtons(model)}
            ${githubHint(model)}
            ${selfHostedSection(base, model.selfHosted)}
        </section>
        ${webhookForm(base, model.webhook)}
        <form method="post" action="${base}/finish" class="finish">
            <button class="primary" type="submit"${canFinish ? '' : ' disabled'}>Continue to ${client}</button>
        </form>
        <form method="post" action="${base}/cancel" class="cancel">
            <button class="quiet" type="submit">Cancel and delete what you entered</button>
        </form>
        <footer class="trust">
            ${LOCK_ICON}
            <p>Tokens and webhooks are encrypted at rest and deleted when you disconnect. Unused connections are deleted after 30 days. <a href="/privacy" target="_blank" rel="noopener">Privacy</a> · <a href="/support" target="_blank" rel="noopener">Support</a> · <a href="${SOURCE_URL}" target="_blank" rel="noopener">Source on GitHub</a></p>
        </footer>`
    )
}

export function renderMessagePage(title: string, body: string): string {
    return renderDocument(
        title,
        `<div class="lockup lockup-solo" aria-hidden="true"><span class="tile tile-standup"><img src="/icon.png" alt="" width="56" height="56"></span></div>
        <h1>${escapeHtml(title)}</h1>
        <p class="lede">${escapeHtml(body)}</p>`
    )
}

// The site root, so anything that resolves the connector's icon from its
// home page finds this one and not the parent domain's.
export function renderLandingPage(mcpUrl: string): string {
    return renderDocument(
        'standup-mr',
        `<div class="lockup lockup-solo" aria-hidden="true"><span class="tile tile-standup"><img src="/icon.png" alt="" width="56" height="56"></span></div>
        <h1>standup-mr</h1>
        <p class="lede">Standup notes from merge request state, for Claude.</p>
        <p class="return">In claude.ai, open Settings, Connectors, Add custom connector, and paste <strong>${escapeHtml(mcpUrl)}</strong></p>
        <footer class="trust"><p><a href="${SOURCE_URL}">Source and docs</a> · <a href="/privacy">Privacy</a> · <a href="/support">Support</a></p></footer>`
    )
}
