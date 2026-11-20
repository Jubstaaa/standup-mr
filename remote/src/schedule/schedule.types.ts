import type { FetchLike } from '../../../src/standup.types'
import type { TokenRefresher } from '../accounts/accounts'
import type { Store } from '../store/store'

export interface SchedulerDeps {
    fetchImpl: FetchLike
    freshAccessToken: TokenRefresher
    now: () => number
    // Overrides SCHEDULE_DEADLINE_MS, the most one run may take.
    scheduleDeadlineMs?: number
    store: Store
}

export interface ScheduleForm {
    days: string[]
    time: string
    timezone: string
}
