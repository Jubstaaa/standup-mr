import { renderDocument, SOURCE_URL } from '../connect/connect-page'

import { CONTACT_EMAIL, ISSUES_URL, POLICY_UPDATED } from './pages.constants'

const CONTACT = `<a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>`

function article(title: string, body: string): string {
    return renderDocument(
        `${title} · standup-mr`,
        `<article class="prose">
            <p class="back"><a href="/">standup-mr</a></p>
            <h1>${title}</h1>
            ${body}
        </article>`
    )
}

export function renderPrivacyPage(): string {
    return article(
        'Privacy policy',
        `<p class="updated">Last updated ${POLICY_UPDATED}</p>
        <p>standup-mr is an open-source project run by İlker Balcılar. This page covers the hosted connector at standup.ilkerbalcilar.com. The CLI and the local MCP server run on your own machine and send nothing here.</p>

        <h2>What is stored</h2>
        <ul>
            <li>The accounts you link: provider, host and username.</li>
            <li>The access and refresh tokens for those accounts, encrypted with AES-256-GCM.</li>
            <li>The chat webhook URL, if you add one, encrypted the same way.</li>
            <li>The tokens Claude uses to reach this server, stored only as SHA-256 hashes, and the client registration Claude sends.</li>
            <li>If you set up sign-in for a self-hosted GitLab or GitHub Enterprise: its host, application ID and secret, the secret encrypted.</li>
            <li>When a connection was created and last used.</li>
        </ul>

        <h2>What is not stored</h2>
        <p>Your merge requests, reviews, pipeline logs and standup notes. They are read from your host when Claude asks for them, returned to Claude, and not kept. The web server keeps standard access logs (IP address, time and path) to run and protect the service; tokens and webhook URLs never appear in them.</p>

        <h2>How it is used</h2>
        <p>Only to do what you ask Claude to do: read your merge requests, reviews and pipeline logs, and post a note to your chat webhook when you ask for it. The connector asks your host for read-only access and never writes to your repositories. There are no analytics, no advertising and no tracking.</p>

        <h2>Who else sees it</h2>
        <p>Nobody is sold or given your data. Requests go to the GitHub or GitLab host you linked and to your chat webhook. The server runs on DigitalOcean behind Cloudflare, which handle the traffic as infrastructure providers.</p>

        <h2>How long it is kept</h2>
        <ul>
            <li>Disconnecting the connector in Claude deletes the connection, its accounts, tokens and webhook at once.</li>
            <li>Connections unused for 30 days are deleted.</li>
            <li>An unfinished connect page is deleted after 15 minutes.</li>
            <li>A self-hosted sign-in setup that nobody signs in with is deleted after a day.</li>
        </ul>

        <h2>Your choices</h2>
        <p>You can remove any linked account on the connect page, disconnect at any time, or revoke the app from your GitHub or GitLab settings. To have anything else deleted, write to ${CONTACT}.</p>

        <h2>Changes and contact</h2>
        <p>Changes to this policy are made in the open, in the <a href="${SOURCE_URL}">source repository</a>. Questions: ${CONTACT}.</p>`
    )
}

export function renderSupportPage(): string {
    return article(
        'Support',
        `<p>Found a bug or need help? <a href="${ISSUES_URL}">Open an issue on GitHub</a>, or write to ${CONTACT}.</p>

        <h2>Common fixes</h2>
        <ul>
            <li><strong>"Reconnect the connector".</strong> A login expired or was revoked. In Claude, open the connector, disconnect, and connect again.</li>
            <li><strong>Organization repositories are missing.</strong> The GitHub App only sees repositories it is installed on. Install it on your organization, or link github.com with a fine-grained token instead.</li>
            <li><strong>Your company's GitLab isn't listed.</strong> Type its host on the connect page. If nobody has set up sign-in yet, the page shows the redirect URI and scopes to register an OAuth application once.</li>
            <li><strong>A GitLab behind a VPN.</strong> The hosted connector can't reach private networks. Run the local server with <code>npx standup-mr mcp</code> instead.</li>
            <li><strong>"Several accounts are linked".</strong> Tell Claude which one: "my GitHub standup", "my work standup".</li>
        </ul>

        <h2>Data</h2>
        <p>See the <a href="/privacy">privacy policy</a> for what is stored and how to delete it.</p>`
    )
}
