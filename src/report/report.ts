import { isoDay, label, previousActiveDay } from '../dates/dates'
import { MS_PER_DAY } from '../dates/dates.constants'
import type { Provider } from '../providers/base/base.types'
import { LOOKBACK_DAYS } from './report.constants'
import type { StandupReport } from '../types/standup.types'

export async function buildReport(
    provider: Provider,
    today: Date,
    lang = 'en',
    lookbackDays = LOOKBACK_DAYS
): Promise<StandupReport> {
    const identity = await provider.getIdentity()

    const since = new Date(today.getTime() - lookbackDays * MS_PER_DAY)
    const events = await provider.getEvents(since)

    const { date: previousDate, gapDays } = previousActiveDay(
        new Set(events.map((e) => e.at.slice(0, 10))),
        today
    )

    const previousEvents = previousDate
        ? events.filter((e) => e.at.slice(0, 10) === previousDate)
        : []
    const todayEvents = events.filter((e) => e.at.slice(0, 10) === isoDay(today))

    const myMrs = await provider.getMyMrs(today)
    const [reviews, blockers] = await Promise.all([
        provider.getReviews(identity, today),
        provider.getBlockers(myMrs),
    ])

    return {
        provider: provider.kind,
        user: identity.username,
        today: { date: isoDay(today), label: label(today, lang) },
        previous: {
            date: previousDate,
            label: previousDate ? label(new Date(`${previousDate}T00:00:00`), lang) : null,
            gapDays,
            eventCount: previousEvents.length,
        },
        previousEvents,
        todayEvents,
        myMrs,
        reviews,
        reviewPendingCount: reviews.filter((r) => !r.approvedByMe).length,
        blockers,
    }
}
