import { describe, expect, it } from 'bun:test'

import { gitlabAt } from '../providers/gitlab/gitlab.tz.helpers'

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

describe('GitLab times', () => {
    const late = '2026-08-27T23:30:00.000Z'

    it('puts a late-evening utc event on the local next day', async () => {
        const [event] = await gitlabAt(late).getEvents(new Date(2026, 7, 20))
        expect(event!.at).toBe('2026-08-28T02:30')
    })

    it('dates my merge requests by the local day', async () => {
        const [row] = await gitlabAt(late).getMyMrs(new Date(2026, 7, 28))
        expect(row!.updated).toBe('2026-08-28')
    })

    it('dates review requests by the local day', async () => {
        const [row] = await gitlabAt(late).getReviews(
            { id: 1, username: 'me' },
            new Date(2026, 7, 28)
        )
        expect(row!.updated).toBe('2026-08-28')
    })
})
