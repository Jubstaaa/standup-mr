export const CONNECT_COOKIE = 'standup_connect'
export const ERROR_MESSAGE_MAX_LENGTH = 300
export const TOKEN_FORM_LIMIT_PER_MINUTE = 10

// Redirect hosts of the MCP clients people actually connect from. A client
// redirecting anywhere else is shown as unrecognized.
export const KNOWN_CLIENT_HOSTS = [
    'claude.ai',
    'claude.com',
    'chatgpt.com',
    'openai.com',
    'vscode.dev',
    'cursor.com',
    'smithery.ai',
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
