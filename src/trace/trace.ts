import { ANSI, ERROR_MARKER, GROUP, MAX_LINE, NOISE, SECTION, SIGNAL, TIMESTAMP } from './trace.constants'

export function extractErrors(rawTrace: string, limit = 8): string[] {
    if (!rawTrace) return []

    const cleaned = rawTrace.replace(ANSI, '').replace(SECTION, '')

    const seen = new Set<string>()
    const hits: string[] = []
    for (const rawLine of cleaned.split('\n')) {
        const stamped = rawLine.trim().replace(TIMESTAMP, '')
        if (GROUP.test(stamped)) continue
        if (!stamped || NOISE.test(stamped) || !SIGNAL.test(stamped)) continue

        const line = stamped.replace(ERROR_MARKER, '').trim()
        if (!line) continue

        const clipped = line.slice(0, MAX_LINE)
        if (seen.has(clipped)) continue
        seen.add(clipped)
        hits.push(clipped)
    }

    return hits.slice(-limit)
}
