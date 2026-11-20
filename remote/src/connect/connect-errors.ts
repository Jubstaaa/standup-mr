import { AccountError } from '../accounts/accounts'
import { errorDetail } from '../errors/errors'
import { ScheduleError } from '../schedule/schedule'
import { HostError } from '../ssrf/ssrf'

import type { ConnectErrorCode } from './connect.constants'

// A HostError already says what is wrong; anything else is unexpected and
// goes to the log before the page falls back to a fixed message.
export function hostErrorCode(
    error: unknown,
    otherwise: ConnectErrorCode = 'host-unreachable'
): ConnectErrorCode {
    if (error instanceof HostError) return error.code
    console.error(`connect page: ${errorDetail(error)}`)
    return otherwise
}

export function digestErrorCode(error: unknown): ConnectErrorCode {
    if (error instanceof AccountError) return 'account-expired'
    if (error instanceof ScheduleError) return error.code
    console.error(`test digest failed: ${errorDetail(error)}`)
    return 'test-failed'
}
