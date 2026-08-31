import { describe, expect, it } from 'bun:test'

import type { Provider } from '../providers/base/base.types'
import { buildReport } from './report'
import type { ActivityEvent, Blocker, Identity, MergeRequest, Review } from '../types/standup.types'

const TODAY = new Date(2026, 7, 28)

interface Overrides {
    events?: ActivityEvent[]
    mrs?: MergeRequest[]
    reviews?: Review[]
    blockers?: Blocker[]
}

function fakeProvider(overrides: Overrides = {}): Provider {
    return {
        kind: 'gitlab',
        getIdentity: async () => ({ id: 1, username: 'dev' }),
        getEvents: async () => overrides.events ?? [],
        getMyMrs: async () => overrides.mrs ?? [],
        getReviews: async () => overrides.reviews ?? [],
        getBlockers: async () => overrides.blockers ?? [],
    }
}

const event = (at: string) => ({ at, action: 'pushed to' }) as ActivityEvent

describe('buildReport', () => {
    it('reports every active day in the gap, oldest first', async () => {
        const report = await buildReport(
            fakeProvider({
                events: [
                    event('2026-08-28T10:00'),
                    event('2026-08-28T11:00'),
                    event('2026-08-29T09:00'),
                    event('2026-08-31T09:00'),
                ],
            }),
            new Date(2026, 7, 31)
        )

        expect(report.previousDays.map((day) => day.date)).toEqual([
            '2026-08-28',
            '2026-08-29',
        ])
        expect(report.previousDays[0]!.events).toHaveLength(2)
        expect(report.previousDays[1]!.events).toHaveLength(1)
        expect(report.todayEvents).toHaveLength(1)
    })

    it('labels each day in the requested language', async () => {
        const provider = fakeProvider({ events: [event('2026-08-27T10:00')] })

        expect((await buildReport(provider, TODAY)).previousDays[0]!.label).toBe(
            'Thursday, 27 August'
        )
        expect((await buildReport(provider, TODAY, 'tr')).previousDays[0]!.label).toBe(
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

    it('reports an empty list when there is no history', async () => {
        const report = await buildReport(fakeProvider(), TODAY)
        expect(report.previousDays).toEqual([])
    })

    it('carries the user and today label', async () => {
        const report = await buildReport(fakeProvider(), TODAY)
        expect(report.user).toBe('dev')
        expect(report.today).toEqual({ date: '2026-08-28', label: 'Friday, 28 August' })
    })

    it('carries the provider kind into the report', async () => {
        const report = await buildReport(fakeProvider(), TODAY)
        expect(report.provider).toBe('gitlab')
    })

    it('hands the whole identity to getReviews', async () => {
        let seen: Identity | undefined
        const provider: Provider = {
            ...fakeProvider(),
            getReviews: async (identity: Identity) => {
                seen = identity
                return []
            },
        }

        await buildReport(provider, TODAY)
        expect(seen).toEqual({ id: 1, username: 'dev' })
    })
})
