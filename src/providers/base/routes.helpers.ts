import type { FetchLike } from '../../types/standup.types'

export const REDIRECT = Symbol('REDIRECT')

const BLOB_LOG_URL = 'https://blob.example.com/log'

function matches(url: string, needle: string): boolean {
    const { pathname, search } = new URL(url)
    if (needle.includes('=')) return search.includes(needle)
    return pathname === needle || pathname.endsWith(needle)
}

export function routedFetch(routes: Record<string, unknown>): FetchLike {
    return async (url: string) => {
        for (const [needle, payload] of Object.entries(routes)) {
            if (!matches(url, needle)) continue
            if (payload === REDIRECT) {
                return new Response(null, {
                    status: 302,
                    headers: { location: BLOB_LOG_URL },
                })
            }
            return typeof payload === 'string'
                ? new Response(payload, { status: 200 })
                : new Response(JSON.stringify(payload), { status: 200 })
        }
        return new Response('[]', { status: 200 })
    }
}
