// Over https the cookie carries the __Host- prefix: it is then host-only
// and secure, so a sibling subdomain cannot plant one of its own and walk
// the user into someone else's sign-in. Plain http (local runs) cannot use
// the prefix.
export const CONNECT_COOKIE = 'standup_connect'
export const SECURE_CONNECT_COOKIE = '__Host-standup_connect'
export const TOKEN_FORM_LIMIT_PER_MINUTE = 10

// The exact callback URLs (origin and path, query ignored) of the MCP
// clients people actually connect from. Whole hosts are not enough: on a
// multi-tenant host such as chatgpt.com anyone can publish a custom GPT
// whose callback lives under the same origin. Anything else is shown as
// unrecognized.
export const KNOWN_CLIENT_REDIRECTS = [
    'https://claude.ai/api/mcp/auth_callback',
    'https://claude.com/api/mcp/auth_callback',
    'https://chatgpt.com/connector_platform_oauth_redirect',
    'https://vscode.dev/redirect',
    'https://insiders.vscode.dev/redirect',
    'https://connect.smithery.ai/oauth/callback',
]
export const KNOWN_CLIENT_SCHEMES = [
    'cursor:',
    'vscode:',
    'vscode-insiders:',
    'windsurf:',
]
export const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]']

// Names an unrecognized client may not borrow: they would make the consent
// page read as if a trusted app were asking.
export const IMPERSONATED_NAMES =
    /claude|anthropic|cursor|vs ?code|visual studio|copilot|chatgpt|openai|gemini|google|codex|smithery|windsurf/i
export const UNKNOWN_CLIENT_NAME = 'An unrecognized app'
export const DEFAULT_CLIENT_NAME = 'An MCP client'

// The only messages the page shows. A redirect carries a code from these
// tables, never text: anything else in ?error= or ?notice= is ignored, so
// the URL cannot put words in the page's mouth. {host} is the validated
// host from the same URL.
export const CONNECT_ERRORS = {
    'account-expired':
        'The test digest was not posted: a linked login has expired. Remove the account and link it again.',
    'finish-no-account': 'Link at least one account first.',
    'host-credentials': 'The host must not contain credentials.',
    'host-invalid': 'That is not a valid host.',
    'host-not-https': 'Only https hosts are supported.',
    'host-port': 'Only the default https port (443) is supported.',
    'host-unreachable': 'Could not reach {host} as a public host.',
    'instance-built-in': '{host} already has a sign-in button above.',
    'instance-fields': 'Both the application ID and the secret are required.',
    'instance-locked':
        'Sign-in for {host} is already set up. Use the sign-in button.',
    'schedule-accounts-unreadable':
        'The test digest was not posted: no linked account could be read. Try again in a few minutes.',
    'schedule-days': 'Pick at least one day.',
    'schedule-invalid': 'Check the schedule and try again.',
    'schedule-never': 'The schedule never runs.',
    'schedule-no-account':
        'The test digest was not posted: no account is linked.',
    'schedule-no-webhook':
        'The test digest was not posted: no webhook is saved.',
    'schedule-time': 'Pick a time as HH:MM.',
    'schedule-timezone': 'Pick a time zone from the list.',
    'signin-cancelled': 'The sign-in was cancelled.',
    'signin-failed': 'Could not sign in to {host}.',
    'signin-failed-instance':
        'Could not sign in to {host}. Check the application ID, secret and redirect URI registered on that host.',
    'test-failed':
        'The test digest was not posted. Check the webhook and try again.',
    'token-fields': 'Provider, host and token are required.',
    'token-rejected': 'The token was not accepted by {host}.',
    'webhook-invalid':
        'Use a Slack, Discord or Google Chat webhook URL (https).',
} as const

export const CONNECT_NOTICES = {
    'schedule-off': 'Automatic posting is off.',
    'schedule-saved': 'Schedule saved.',
    'test-posted': 'Test digest posted.',
} as const

export type ConnectErrorCode = keyof typeof CONNECT_ERRORS
export type ConnectNoticeCode = keyof typeof CONNECT_NOTICES
