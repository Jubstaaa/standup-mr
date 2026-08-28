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
