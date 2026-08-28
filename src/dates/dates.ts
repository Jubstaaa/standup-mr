import { DAYS, MONTHS, MS_PER_DAY } from './dates.constants'

export function isoDay(day: Date): string {
    return day.toISOString().slice(0, 10)
}

export function label(day: Date, lang = 'en'): string {
    const key = DAYS[lang] ? lang : 'en'
    const weekday = DAYS[key]![day.getUTCDay()]!
    const month = MONTHS[key]![day.getUTCMonth()]!
    const date = day.getUTCDate()
    return key === 'tr' ? `${date} ${month} ${weekday}` : `${weekday}, ${date} ${month}`
}

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
