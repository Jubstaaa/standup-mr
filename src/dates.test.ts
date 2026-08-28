import { describe, expect, it } from 'bun:test'

import { isoDay, label, previousActiveDay } from './dates'

const day = (iso: string) => new Date(`${iso}T00:00:00Z`)

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
    it('renders a UTC calendar date', () => {
        expect(isoDay(day('2026-08-28'))).toBe('2026-08-28')
    })
})

describe('previousActiveDay', () => {
    it('picks the most recent past day', () => {
        const dates = new Set(['2026-08-25', '2026-08-26', '2026-08-28'])
        expect(previousActiveDay(dates, day('2026-08-28'))).toEqual({
            date: '2026-08-26',
            gapDays: 2,
        })
    })

    it('skips the weekend', () => {
        // Monday 31 August; last activity was Friday 28 August.
        expect(previousActiveDay(new Set(['2026-08-28']), day('2026-08-31'))).toEqual({
            date: '2026-08-28',
            gapDays: 3,
        })
    })

    it('ignores today', () => {
        expect(previousActiveDay(new Set(['2026-08-28']), day('2026-08-28'))).toEqual({
            date: null,
            gapDays: null,
        })
    })

    it('handles an empty history', () => {
        expect(previousActiveDay(new Set(), day('2026-08-28'))).toEqual({
            date: null,
            gapDays: null,
        })
    })
})
