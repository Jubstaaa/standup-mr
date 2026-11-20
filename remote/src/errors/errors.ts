export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

// For log lines: the message and every cause behind it, which is where a
// wrapped database or network error keeps what actually went wrong.
export function errorDetail(error: unknown): string {
    const parts: string[] = []
    const seen = new Set<unknown>()
    let current: unknown = error
    while (current !== undefined && current !== null && !seen.has(current)) {
        seen.add(current)
        if (current instanceof Error) {
            parts.push(current.message)
            current = current.cause
        } else {
            if (typeof current === 'string') parts.push(current)
            break
        }
    }
    return parts.join(' <- ')
}
