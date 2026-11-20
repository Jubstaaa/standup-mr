export const CONNECT_COOKIE = 'standup_connect'
export const ERROR_MESSAGE_MAX_LENGTH = 300
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
