import { DAYS, MONTHS, MS_PER_DAY } from './dates.constants'

export function isoDay(day: Date): string {
    const year = day.getFullYear()
    const month = String(day.getMonth() + 1).padStart(2, '0')
    const date = String(day.getDate()).padStart(2, '0')
    return `${year}-${month}-${date}`
}

export function localAt(iso: string): string {
    const at = new Date(iso)
    const hours = String(at.getHours()).padStart(2, '0')
    const minutes = String(at.getMinutes()).padStart(2, '0')
    return `${isoDay(at)}T${hours}:${minutes}`
}

export function label(day: Date, lang = 'en'): string {
    const key = DAYS[lang] ? lang : 'en'
    const weekday = DAYS[key]![day.getDay()]!
    const month = MONTHS[key]![day.getMonth()]!
    const date = day.getDate()
    return key === 'tr' ? `${date} ${month} ${weekday}` : `${weekday}, ${date} ${month}`
}

function isWeekday(day: string): boolean {
    const weekday = new Date(`${day}T00:00:00`).getDay()
    return weekday >= 1 && weekday <= 5
}

export function previousActiveDays(
    eventDates: Set<string>,
    today: Date
): Array<{ date: string; gapDays: number }> {
    const cutoff = isoDay(today)
    const past = [...eventDates].filter((day) => day < cutoff).sort()
    if (past.length === 0) return []

    const anchor = past.filter(isWeekday).pop() ?? past[0]!

    return past
        .filter((day) => day >= anchor)
        .map((day) => ({
            date: day,
            gapDays: Math.round(
                (Date.parse(`${cutoff}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) /
                    MS_PER_DAY
            ),
        }))
}
