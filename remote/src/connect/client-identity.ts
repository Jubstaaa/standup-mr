import {
    DEFAULT_CLIENT_NAME,
    IMPERSONATED_NAMES,
    KNOWN_CLIENT_HOSTS,
    KNOWN_CLIENT_SCHEMES,
    LOOPBACK_HOSTS,
    UNKNOWN_CLIENT_NAME,
} from './connect.constants'

export interface ClientIdentity {
    isRecognized: boolean
    name: string
    redirectHost: string
}

function isRecognizedRedirect(url: URL): boolean {
    if (KNOWN_CLIENT_SCHEMES.includes(url.protocol)) return true
    // A loopback redirect is an app already running on the user's machine,
    // which is how Claude Code, Gemini CLI and Codex sign in.
    if (LOOPBACK_HOSTS.includes(url.hostname)) return true
    if (url.protocol !== 'https:') return false
    return KNOWN_CLIENT_HOSTS.some(
        host => url.hostname === host || url.hostname.endsWith(`.${host}`)
    )
}

// Anyone can register a client with any name, so the name is only shown
// as-is when the redirect goes where that kind of client lives.
export function identifyClient(
    clientName: string | undefined,
    redirectUri: string
): ClientIdentity {
    const url = new URL(redirectUri)
    const isRecognized = isRecognizedRedirect(url)
    const claimed = clientName?.trim() || DEFAULT_CLIENT_NAME
    const name =
        !isRecognized && IMPERSONATED_NAMES.test(claimed)
            ? UNKNOWN_CLIENT_NAME
            : claimed
    return { isRecognized, name, redirectHost: url.host || url.protocol }
}
