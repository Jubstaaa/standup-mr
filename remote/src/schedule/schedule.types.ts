import type { FetchLike } from '../../../src/types/standup.types'
import type { TokenRefresher } from '../accounts/accounts'
import type { Store } from '../store/store'

export interface SchedulerDeps {
    fetchImpl: FetchLike
    freshAccessToken: TokenRefresher
    now: () => number
    store: Store
}

export interface ScheduleForm {
    days: string[]
    time: string
    timezone: string
}
