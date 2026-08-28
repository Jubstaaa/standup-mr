import { ANSI, MAX_LINE, NOISE, SECTION, SIGNAL } from './trace.constants'

export function extractErrors(rawTrace: string, limit = 8): string[] {
    if (!rawTrace) return []

    const cleaned = rawTrace.replace(ANSI, '').replace(SECTION, '')

    const seen = new Set<string>()
    const hits: string[] = []
    for (const rawLine of cleaned.split('\n')) {
        const line = rawLine.trim()
        if (!line || NOISE.test(line) || !SIGNAL.test(line)) continue
        const clipped = line.slice(0, MAX_LINE)
        if (seen.has(clipped)) continue
        seen.add(clipped)
        hits.push(clipped)
    }

    return hits.slice(-limit)
}
