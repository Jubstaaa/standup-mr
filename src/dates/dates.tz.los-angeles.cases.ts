import { describe, expect, it } from 'bun:test'

import { localAt } from './dates'

describe('localAt', () => {
    it('moves an early-morning utc instant onto the local previous day', () => {
        expect(localAt('2026-08-28T05:00:00Z')).toBe('2026-08-27T22:00')
    })

    it('rolls the local date backward across a month boundary', () => {
        expect(localAt('2026-09-01T03:00:00Z')).toBe('2026-08-31T20:00')
    })
})
