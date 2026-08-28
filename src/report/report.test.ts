import { describe, expect, it } from 'bun:test'

import type { Provider } from '../providers/base/base.types'
import { buildReport } from './report'
import type { ActivityEvent, Blocker, MergeRequest, Review } from '../types/standup.types'

const TODAY = new Date(2026, 7, 28)

interface Overrides {
    events?: ActivityEvent[]
    mrs?: MergeRequest[]
    reviews?: Review[]
    blockers?: Blocker[]
}

function fakeProvider(overrides: Overrides = {}): Provider {
    return {
        getIdentity: async () => ({ id: 1, username: 'dev' }),
        getEvents: async () => overrides.events ?? [],
        getMyMrs: async () => overrides.mrs ?? [],
        getReviews: async () => overrides.reviews ?? [],
        getBlockers: async () => overrides.blockers ?? [],
    }
}

const event = (at: string) => ({ at, action: 'pushed to' }) as ActivityEvent

describe('buildReport', () => {
    it('splits events into the previous day and today', async () => {
        const report = await buildReport(
            fakeProvider({
                events: [
                    event('2026-08-27T10:00'),
                    event('2026-08-27T11:00'),
                    event('2026-08-28T09:00'),
                ],
            }),
            TODAY
        )

        expect(report.previous.date).toBe('2026-08-27')
        expect(report.previous.eventCount).toBe(2)
        expect(report.previousEvents).toHaveLength(2)
        expect(report.todayEvents).toHaveLength(1)
    })

    it('labels the previous day in the requested language', async () => {
        const provider = fakeProvider({ events: [event('2026-08-27T10:00')] })

        expect((await buildReport(provider, TODAY)).previous.label).toBe(
            'Thursday, 27 August'
        )
        expect((await buildReport(provider, TODAY, 'tr')).previous.label).toBe(
            '27 Ağustos Perşembe'
        )
    })

    it('excludes merge requests I approved from the pending count', async () => {
        const report = await buildReport(
            fakeProvider({
                reviews: [
                    { iid: 45, approvedByMe: true },
                    { iid: 51, approvedByMe: true },
                    { iid: 54, approvedByMe: false },
                ] as Review[],
            }),
            TODAY
        )

        expect(report.reviewPendingCount).toBe(1)
        expect(report.reviews).toHaveLength(3)
    })

    it('reports a null previous day when there is no history', async () => {
        const report = await buildReport(fakeProvider(), TODAY)
        expect(report.previous.date).toBeNull()
        expect(report.previous.label).toBeNull()
        expect(report.previousEvents).toEqual([])
    })

    it('carries the user and today label', async () => {
        const report = await buildReport(fakeProvider(), TODAY)
        expect(report.user).toBe('dev')
        expect(report.today).toEqual({ date: '2026-08-28', label: 'Friday, 28 August' })
    })
})
