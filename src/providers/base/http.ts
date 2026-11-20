import type { FetchLike } from '../../standup.types'

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

// A host that accepts the socket and never answers would otherwise hang the
// CLI and the MCP tool call for good; fetch has no default timeout.
export const REQUEST_CONCURRENCY = 4

export const REQUEST_TIMEOUT_MS = 30_000

export function timedFetch(
    ms: number = REQUEST_TIMEOUT_MS,
    base: FetchLike = (url, init) => fetch(url, init)
): FetchLike {
    return (url, init) =>
        base(url, { ...init, signal: init?.signal ?? AbortSignal.timeout(ms) })
}

// Response bodies come from hosts the user picks and land in a small
// container, so none is buffered whole. Job logs keep their tail, where the
// failure is; JSON over the cap is refused rather than cut mid-document.
export const LOG_BYTES_CAP = 2 * 1024 * 1024
export const JSON_BYTES_CAP = 8 * 1024 * 1024

async function* chunksOf(response: Response): AsyncGenerator<Uint8Array> {
    if (!response.body) return
    const reader = response.body.getReader()
    try {
        for (;;) {
            const { done, value } = await reader.read()
            if (done) return
            yield value
        }
    } finally {
        await reader.cancel()
    }
}

export async function readTail(
    response: Response,
    maxBytes: number = LOG_BYTES_CAP
): Promise<string> {
    const kept: Uint8Array[] = []
    let size = 0
    for await (const chunk of chunksOf(response)) {
        kept.push(chunk)
        size += chunk.byteLength
        while (kept.length > 1 && size - kept[0]!.byteLength >= maxBytes) {
            size -= kept.shift()!.byteLength
        }
    }
    const bytes = Buffer.concat(kept)
    return bytes.subarray(Math.max(0, bytes.length - maxBytes)).toString('utf8')
}

export async function readJsonCapped(
    response: Response,
    maxBytes: number,
    host: string
): Promise<unknown> {
    const kept: Uint8Array[] = []
    let size = 0
    for await (const chunk of chunksOf(response)) {
        size += chunk.byteLength
        if (size > maxBytes) {
            throw new ApiError(
                `${host} sent more than ${maxBytes} bytes in one response.`
            )
        }
        kept.push(chunk)
    }
    return JSON.parse(Buffer.concat(kept).toString('utf8'))
}

export const RETRY_ATTEMPTS = 3
export const RETRY_BACKOFF_MS = [250, 750]

export type Sleep = (ms: number) => Promise<void>

// Hand-written rather than p-retry: the CLI core ships with no runtime
// dependencies (README, Requirements), and the backoff is two fixed steps.
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
