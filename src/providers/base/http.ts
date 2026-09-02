import type { FetchLike } from '../../types/standup.types'

export function buildUrl(
    api: string,
    path: string,
    params?: Record<string, string | number>
): string {
    const base = `${api}/${path}`
    if (!params || Object.keys(params).length === 0) return base
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
        query.set(key, String(value))
    }
    return `${base}?${query.toString()}`
}

export class ApiError extends Error {
    readonly status?: number

    constructor(message: string, status?: number) {
        super(message)
        this.name = 'ApiError'
        this.status = status
    }
}

function remaining(response: Response): string | null {
    return (
        response.headers.get('x-ratelimit-remaining') ??
        response.headers.get('ratelimit-remaining')
    )
}

function resetAt(response: Response): string {
    const reset =
        response.headers.get('x-ratelimit-reset') ??
        response.headers.get('ratelimit-reset')
    if (!reset) return ''
    const seconds = Number(reset)
    if (!Number.isFinite(seconds) || seconds <= 0) return ''
    return `; resets at ${new Date(seconds * 1000).toISOString()}`
}

function retryAfter(response: Response): string {
    const value = response.headers.get('retry-after')
    if (!value) return ''
    const seconds = Number(value)
    if (!Number.isFinite(seconds) || seconds <= 0)
        return `; retry after ${value}`
    return `; retry after ${seconds}s`
}

export function assertUsable(response: Response, host: string): void {
    if (response.ok || response.status === 404) return

    if (response.status === 403 || response.status === 429) {
        if (remaining(response) === '0') {
            throw new ApiError(
                `${host} rate limit reached${resetAt(response)}.`,
                response.status
            )
        }
        const retry = retryAfter(response)
        if (retry)
            throw new ApiError(
                `${host} rate limit reached${retry}.`,
                response.status
            )
    }

    if (response.status === 401) {
        throw new ApiError(
            `${host} rejected the token (401). Check the token and its scopes.`,
            401
        )
    }

    if (response.status === 403) {
        throw new ApiError(
            `${host} refused the request (403). The token has no access to that resource.`,
            403
        )
    }

    throw new ApiError(`${host} returned ${response.status}.`, response.status)
}

export function unreachable(host: string, cause: unknown): ApiError {
    const detail = cause instanceof Error ? cause.message : String(cause)
    return new ApiError(`Could not reach ${host}: ${detail}`)
}

export const RETRY_ATTEMPTS = 3
export const RETRY_BACKOFF_MS = [250, 750]

export type Sleep = (ms: number) => Promise<void>

const wait: Sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

export async function sendWithRetry(
    fetchImpl: FetchLike,
    url: string,
    init: RequestInit | undefined,
    host: string,
    sleep: Sleep = wait
): Promise<Response> {
    let last: unknown

    for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt += 1) {
        if (attempt > 0) await sleep(RETRY_BACKOFF_MS[attempt - 1]!)
        const final = attempt === RETRY_ATTEMPTS - 1

        try {
            const response = await fetchImpl(url, init)
            if (response.status >= 500 && !final) continue
            return response
        } catch (cause) {
            last = cause
            if (final) throw unreachable(host, cause)
        }
    }

    throw unreachable(host, last)
}
