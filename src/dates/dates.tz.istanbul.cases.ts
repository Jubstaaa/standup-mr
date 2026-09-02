import { describe, expect, it } from 'bun:test'

import { localAt } from './dates'

describe('localAt', () => {
    it('moves a late-evening utc instant onto the local next day', () => {
        expect(localAt('2026-08-27T23:30:00Z')).toBe('2026-08-28T02:30')
    })

    it('rolls the local date across a month boundary', () => {
        expect(localAt('2026-08-31T22:00:00Z')).toBe('2026-09-01T01:00')
    })

    it('keeps an offset-carrying timestamp on its own wall clock', () => {
        expect(localAt('2026-08-27T10:57:00.000+03:00')).toBe(
            '2026-08-27T10:57'
        )
    })

    it('pads single-digit fields', () => {
        expect(localAt('2026-01-02T03:04:00Z')).toBe('2026-01-02T06:04')
    })
})
