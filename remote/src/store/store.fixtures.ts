import type { Store } from './store'
import type { PendingAuthorization } from './store.types'

export const BROWSER_SECRET = 'browser-secret'

export function startConnection(
    store: Store,
    now = 0,
    pendingId = 'pending'
): PendingAuthorization {
    return store.createPending(
        {
            pendingId,
            browserSecret: BROWSER_SECRET,
            clientId: 'claude',
            codeChallenge: 'challenge',
            redirectUri: 'https://claude.ai/api/mcp/auth_callback',
            resource: null,
            scopes: [],
            state: 'xyz',
        },
        now
    )
}
