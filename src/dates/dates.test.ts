import { describe, expect, it } from 'bun:test'

import { isoDay, label, previousActiveDays } from './dates'

const day = (iso: string) => {
    const [year, month, date] = iso.split('-').map(Number)
    return new Date(year!, month! - 1, date!)
}

describe('label', () => {
    it('formats English as weekday, day month', () => {
        expect(label(day('2026-08-28'), 'en')).toBe('Friday, 28 August')
    })

    it('formats Turkish as day month weekday', () => {
        expect(label(day('2026-08-28'), 'tr')).toBe('28 Ağustos Cuma')
    })

    it('defaults to English', () => {
        expect(label(day('2026-08-28'))).toBe('Friday, 28 August')
    })

    it('falls back to English for an unknown language', () => {
        expect(label(day('2026-08-28'), 'de')).toBe('Friday, 28 August')
    })
})

describe('isoDay', () => {
    it('renders a local calendar date', () => {
        expect(isoDay(day('2026-08-28'))).toBe('2026-08-28')
    })

    it('uses the local calendar day late in the evening behind UTC', () => {
        const lateEvening = new Date(2026, 7, 28, 20, 0)

        expect(isoDay(lateEvening)).toBe('2026-08-28')
        expect(label(lateEvening, 'en')).toBe('Friday, 28 August')
    })

    it('uses the local calendar day early in the morning ahead of UTC', () => {
        const earlyMorning = new Date(2026, 7, 28, 2, 0)

        expect(isoDay(earlyMorning)).toBe('2026-08-28')
        expect(label(earlyMorning, 'en')).toBe('Friday, 28 August')
    })
})

describe('previousActiveDays', () => {
    const monday = new Date(2026, 7, 31)

    it('returns nothing when there is no history', () => {
        expect(previousActiveDays(new Set(), monday)).toEqual([])
    })

    it('keeps the friday when a saturday also has activity', () => {
        const active = new Set(['2026-08-28', '2026-08-29'])
        expect(previousActiveDays(active, monday)).toEqual([
            { date: '2026-08-28', gapDays: 3 },
            { date: '2026-08-29', gapDays: 2 },
        ])
    })

    it('anchors on the most recent active weekday, not the most recent day', () => {
        const active = new Set(['2026-08-26', '2026-08-28', '2026-08-29'])
        const days = previousActiveDays(active, monday)
        expect(days.map(day => day.date)).toEqual(['2026-08-28', '2026-08-29'])
    })

    it('reports a single day when only yesterday was active', () => {
        const tuesday = new Date(2026, 7, 25)
        expect(previousActiveDays(new Set(['2026-08-24']), tuesday)).toEqual([
            { date: '2026-08-24', gapDays: 1 },
        ])
    })

    it('includes a sunday tail after the friday anchor', () => {
        const active = new Set(['2026-08-28', '2026-08-30'])
        expect(previousActiveDays(active, monday).map(day => day.date)).toEqual(
            ['2026-08-28', '2026-08-30']
        )
    })

    it('reports every active day when no weekday was active at all', () => {
        const active = new Set(['2026-08-29', '2026-08-30'])
        expect(previousActiveDays(active, monday).map(day => day.date)).toEqual(
            ['2026-08-29', '2026-08-30']
        )
    })

    it('ignores today and anything after it', () => {
        const active = new Set(['2026-08-28', '2026-08-31', '2026-09-01'])
        expect(previousActiveDays(active, monday).map(day => day.date)).toEqual(
            ['2026-08-28']
        )
    })
})
