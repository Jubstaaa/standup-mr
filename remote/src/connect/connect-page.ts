import escapeHtml from 'escape-html'

import { describeAccount } from '../accounts/accounts'
import type { Account } from '../accounts/accounts.types'
import type { Webhook } from '../store/store.types'

import { PAGE_STYLE } from './connect-page.constants'

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

function maskWebhook(url: string): string {
    const parsed = new URL(url)
    return `${parsed.host}/…${parsed.pathname.slice(-4)}`
}

export function renderConnectPage(model: ConnectPageModel): string {
    const base = `/connect/${encodeURIComponent(model.pendingId)}`

    const accounts = model.accounts.length
        ? model.accounts
              .map(
                  account => `
            <li>
                <span>✓ ${escapeHtml(describeAccount(account))}</span>
                <form method="post" action="${base}/accounts/${encodeURIComponent(account.id)}/remove">
                    <button class="link" type="submit">Remove</button>
                </form>
            </li>`
              )
              .join('')
        : '<li class="muted">No account linked yet.</li>'

    const oauthButtons = [
        model.githubAvailable
            ? `<a class="button" href="${base}/link/github">Connect GitHub</a>`
            : '',
        model.gitlabAvailable
            ? `<a class="button" href="${base}/link/gitlab">Connect gitlab.com</a>`
            : '',
    ].join('')

    const githubNote =
        model.githubAvailable && model.githubInstallUrl
            ? `<p class="muted small">Org repositories missing? The GitHub App only sees repositories it is installed on —
               <a href="${escapeHtml(model.githubInstallUrl)}" target="_blank" rel="noopener">install it on your account or org</a>.
               If your org won't approve it, add github.com below with a fine-grained token instead.</p>`
            : ''

    const webhook = model.webhook
        ? `<p>Saved: ${escapeHtml(model.webhook.kind)} · ${escapeHtml(maskWebhook(model.webhook.url))}</p>`
        : ''

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Connect standup-mr</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/icon.png" type="image/png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<style>${PAGE_STYLE}</style>
</head>
<body>
<main>
    <h1>Connect standup-mr</h1>
    <p class="requester"><strong>${escapeHtml(model.clientName)}</strong> is asking for access, and will be sent back to <strong>${escapeHtml(model.redirectHost)}</strong>. Only continue if you started this from that app.</p>
    <p class="muted">Link the accounts your standup should read. You can link several — GitHub for side projects, a self-hosted GitLab for work.</p>

    ${model.error ? `<p class="error" role="alert">${escapeHtml(model.error)}</p>` : ''}

    <section>
        <h2>Linked accounts</h2>
        <ul class="accounts">${accounts}</ul>
        <div class="row">${oauthButtons}</div>
        ${githubNote}
    </section>

    <section>
        <h2>Self-hosted or token</h2>
        <p class="muted small">Self-hosted GitLab, GitHub Enterprise, or github.com with a personal access token. A read-only token is enough: <code>read_api</code> on GitLab, read access to pull requests, actions and checks on GitHub.</p>
        <form method="post" action="${base}/token" class="stack">
            <label>Provider
                <select name="provider">
                    <option value="gitlab">GitLab</option>
                    <option value="github">GitHub / GitHub Enterprise</option>
                </select>
            </label>
            <label>Host <input name="host" placeholder="gitlab.example.com" required autocomplete="off"></label>
            <label>Token <input name="token" type="password" required autocomplete="off"></label>
            <button type="submit">Add account</button>
        </form>
    </section>

    <section>
        <h2>Chat webhook <span class="muted small">(optional)</span></h2>
        <p class="muted small">Lets Claude post the finished note to Slack, Discord or Google Chat when you ask it to.</p>
        ${webhook}
        <form method="post" action="${base}/webhook" class="stack">
            <input name="url" type="password" placeholder="https://hooks.slack.com/services/…" autocomplete="off">
            <button type="submit">${model.webhook ? 'Replace webhook' : 'Save webhook'}</button>
        </form>
        ${model.webhook ? `<form method="post" action="${base}/webhook"><input type="hidden" name="url" value=""><button class="link" type="submit">Remove webhook</button></form>` : ''}
    </section>

    <form method="post" action="${base}/finish">
        <button class="primary" type="submit" ${model.accounts.length ? '' : 'disabled'}>Finish and return to Claude</button>
    </form>
    <form method="post" action="${base}/cancel">
        <button class="link" type="submit">Cancel and delete everything entered here</button>
    </form>

    <footer class="muted small">
        Tokens and the webhook URL are encrypted at rest and used only to read your merge requests and post your note.
        Disconnecting the connector deletes them; unused connections are deleted after 30 days.
        <a href="https://github.com/Jubstaaa/standup-mr" target="_blank" rel="noopener">Source code</a>.
    </footer>
</main>
</body>
</html>`
}

export function renderMessagePage(title: string, body: string): string {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${PAGE_STYLE}</style>
</head>
<body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p></main></body>
</html>`
}
