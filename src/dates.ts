/** Date labelling and "what was the last day I actually worked" resolution. */

const DAYS: Record<string, string[]> = {
    en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    tr: ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'],
}

const MONTHS: Record<string, string[]> = {
    en: [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December',
    ],
    tr: [
        'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
        'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
    ],
}

const MS_PER_DAY = 86_400_000

/** `YYYY-MM-DD` in UTC, so labels and comparisons never disagree. */
export function isoDay(day: Date): string {
    return day.toISOString().slice(0, 10)
}

/** Human date label. Unknown languages fall back to English. */
export function label(day: Date, lang = 'en'): string {
    const key = DAYS[lang] ? lang : 'en'
    const weekday = DAYS[key]![day.getUTCDay()]!
    const month = MONTHS[key]![day.getUTCMonth()]!
    const date = day.getUTCDate()
    return key === 'tr' ? `${date} ${month} ${weekday}` : `${weekday}, ${date} ${month}`
}

/**
 * Most recent day before `today` that had activity.
 *
 * Resolving by activity rather than by calendar means Monday correctly reports
 * Friday, with no weekend special-casing.
 */
export function previousActiveDay(
    eventDates: Set<string>,
    today: Date
): { date: string | null; gapDays: number | null } {
    const cutoff = isoDay(today)
    const past = [...eventDates].filter((d) => d < cutoff).sort()
    const latest = past[past.length - 1]
    if (!latest) return { date: null, gapDays: null }

    const gapDays = Math.round(
        (Date.parse(`${cutoff}T00:00:00Z`) - Date.parse(`${latest}T00:00:00Z`)) / MS_PER_DAY
    )
    return { date: latest, gapDays }
}
