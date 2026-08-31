export class ApiError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'ApiError'
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
        response.headers.get('x-ratelimit-reset') ?? response.headers.get('ratelimit-reset')
    if (!reset) return ''
    const seconds = Number(reset)
    if (!Number.isFinite(seconds) || seconds <= 0) return ''
    return `; resets at ${new Date(seconds * 1000).toISOString()}`
}

function retryAfter(response: Response): string {
    const value = response.headers.get('retry-after')
    if (!value) return ''
    const seconds = Number(value)
    if (!Number.isFinite(seconds) || seconds <= 0) return `; retry after ${value}`
    return `; retry after ${seconds}s`
}

export function assertUsable(response: Response, host: string): void {
    if (response.ok || response.status === 404) return

    if (response.status === 403 || response.status === 429) {
        if (remaining(response) === '0') {
            throw new ApiError(`${host} rate limit reached${resetAt(response)}.`)
        }
        const retry = retryAfter(response)
        if (retry) throw new ApiError(`${host} rate limit reached${retry}.`)
    }

    if (response.status === 401) {
        throw new ApiError(
            `${host} rejected the token (401). Check the token and its scopes.`
        )
    }

    if (response.status === 403) {
        throw new ApiError(
            `${host} refused the request (403). The token has no access to that resource.`
        )
    }

    throw new ApiError(`${host} returned ${response.status}.`)
}

export function unreachable(host: string, cause: unknown): ApiError {
    const detail = cause instanceof Error ? cause.message : String(cause)
    return new ApiError(`Could not reach ${host}: ${detail}`)
}
