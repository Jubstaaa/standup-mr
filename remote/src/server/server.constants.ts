// Counts every MCP message, not only tool calls: initialize, the
// initialized notification and tools/list each take one.
export const MCP_CALLS_PER_MINUTE = 60

export const ICON_CACHE = '7d'
export const ICON_ROUTES = {
    '/favicon.ico': 'icon-400.png',
    '/icon.png': 'icon-512.png',
    '/apple-touch-icon.png': 'icon-400.png',
    '/favicon.svg': 'icon.svg',
}

// What a directory or an agent needs to see what the server does before
// anyone signs in. Tool calls and prompts still need a token.
export const PUBLIC_MCP_METHODS = new Set([
    'initialize',
    'notifications/initialized',
    'ping',
    'tools/list',
    'prompts/list',
])
