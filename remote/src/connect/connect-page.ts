import escapeHtml from 'escape-html'

import type { Account } from '../accounts/accounts.types'
import type { Webhook } from '../store/store.types'

import { PAGE_STYLE } from './connect-page.constants'
import {
    CHECK_ICON,
    CLAUDE_ICON,
    CROSS_ICON,
    LOCK_ICON,
    MERGE_LINE,
    PROVIDER_ICONS,
} from './connect-page.icons'

export interface ConnectPageModel {
    accounts: Account[]
    clientName: string
    error?: string
    githubAvailable: boolean
    githubInstallUrl?: string
    gitlabAvailable: boolean
    pendingId: string
    redirectHost: string
    webhook?: Webhook
}

const SOURCE_URL = 'https://github.com/Jubstaaa/standup-mr'

const WEBHOOK_NAMES: Record<Webhook['kind'], string> = {
    'slack': 'Slack',
    'discord': 'Discord',
    'google-chat': 'Google Chat',
}

function document(title: string, body: string): string {
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

function providerButtons(base: string, model: ConnectPageModel): string {
    const buttons = [
        model.githubAvailable
            ? `<a class="provider" href="${base}/link/github">${PROVIDER_ICONS.github}<span>Link a GitHub account</span></a>`
            : '',
        model.gitlabAvailable
            ? `<a class="provider" href="${base}/link/gitlab">${PROVIDER_ICONS.gitlab}<span>Link a gitlab.com account</span></a>`
            : '',
    ].join('')
    return buttons ? `<div class="providers">${buttons}</div>` : ''
}

function githubHint(model: ConnectPageModel): string {
    if (!model.githubAvailable || !model.githubInstallUrl) return ''
    return `<p class="hint">Org repositories missing? <a href="${escapeHtml(model.githubInstallUrl)}" target="_blank" rel="noopener">Install the GitHub App on your org</a>, or add github.com with a fine-grained token below.</p>`
}

function tokenForm(base: string): string {
    return `<details class="disclosure">
        <summary>Use a token or a self-hosted instance</summary>
        <form method="post" action="${base}/token" class="fields">
            <p class="hint">For self-hosted GitLab, GitHub Enterprise, or github.com without the app. A read-only token is enough: <code>read_api</code> on GitLab; read access to pull requests, actions and checks on GitHub.</p>
            <label>Provider
                <select name="provider">
                    <option value="gitlab">GitLab</option>
                    <option value="github">GitHub or GitHub Enterprise</option>
                </select>
            </label>
            <label>Host <input name="host" placeholder="gitlab.example.com" required autocomplete="off" autocapitalize="off" spellcheck="false"></label>
            <label>Token <input name="token" type="password" required autocomplete="off"></label>
            <button class="secondary" type="submit">Add account</button>
        </form>
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

    return document(
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
            ${providerButtons(base, model)}
            ${githubHint(model)}
            ${tokenForm(base)}
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
            <p>Tokens and webhooks are encrypted at rest and deleted when you disconnect. Unused connections are deleted after 30 days. <a href="${SOURCE_URL}" target="_blank" rel="noopener">Source on GitHub</a></p>
        </footer>`
    )
}

export function renderMessagePage(title: string, body: string): string {
    return document(
        title,
        `<div class="lockup lockup-solo" aria-hidden="true"><span class="tile tile-standup"><img src="/icon.png" alt="" width="56" height="56"></span></div>
        <h1>${escapeHtml(title)}</h1>
        <p class="lede">${escapeHtml(body)}</p>`
    )
}
