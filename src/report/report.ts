import { isoDay, label, previousActiveDays } from '../dates/dates'
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

    const days = previousActiveDays(
        new Set(events.map(e => e.at.slice(0, 10))),
        today
    )

    const previousDays = days.map(({ date, gapDays }) => ({
        date,
        label: label(new Date(`${date}T00:00:00`), lang),
        gapDays,
        events: events.filter(e => e.at.slice(0, 10) === date),
    }))

    const todayEvents = events.filter(e => e.at.slice(0, 10) === isoDay(today))

    const myMrs = await provider.getMyMrs(today)
    const [reviews, blockers] = await Promise.all([
        provider.getReviews(identity, today),
        provider.getBlockers(myMrs),
    ])

    return {
        provider: provider.kind,
        user: identity.username,
        today: { date: isoDay(today), label: label(today, lang) },
        previousDays,
        todayEvents,
        myMrs,
        reviews,
        reviewPendingCount: reviews.filter(r => !r.approvedByMe).length,
        blockers,
    }
}
