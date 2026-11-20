import { describe, expect, it } from 'bun:test'

import { gitlabAt } from '../providers/gitlab/gitlab.tz.helpers'

import { localAt } from './dates'

describe('localAt', () => {
    it('moves an early-morning utc instant onto the local previous day', () => {
        expect(localAt('2026-08-28T05:00:00Z')).toBe('2026-08-27T22:00')
    })

    it('rolls the local date backward across a month boundary', () => {
        expect(localAt('2026-09-01T03:00:00Z')).toBe('2026-08-31T20:00')
    })
})

describe('GitLab times', () => {
    const early = '2026-08-28T05:00:00.000Z'

    it('puts an early-morning utc event on the local previous day', async () => {
        const [event] = await gitlabAt(early).getEvents(new Date(2026, 7, 20))
        expect(event!.at).toBe('2026-08-27T22:00')
    })

    it('dates my merge requests by the local day', async () => {
        const [row] = await gitlabAt(early).getMyMrs(new Date(2026, 7, 28))
        expect(row!.updated).toBe('2026-08-27')
    })

    it('dates review requests by the local day', async () => {
        const [row] = await gitlabAt(early).getReviews(
            { id: 1, username: 'me' },
            new Date(2026, 7, 28)
        )
        expect(row!.updated).toBe('2026-08-27')
    })
})
