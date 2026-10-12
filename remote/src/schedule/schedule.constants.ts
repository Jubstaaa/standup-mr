const MINUTE = 60_000

export const TICK_INTERVAL_MS = MINUTE
// A run missed by more than this (the server was down) is skipped, so a
// morning standup does not land in the channel in the afternoon.
export const CATCH_UP_LIMIT_MS = 30 * MINUTE

export const TIMEZONES: readonly string[] = Intl.supportedValuesOf('timeZone')
export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

export const DEFAULT_TIME = '09:30'
export const DEFAULT_TIMEZONE = 'Europe/Istanbul'
export const WEEKDAYS = '1,2,3,4,5'
export const EVERY_DAY = '0,1,2,3,4,5,6'

// Monday first, as the form shows them; values are cron day-of-week numbers.
export const DAY_NAMES: ReadonlyArray<[string, string]> = [
    ['1', 'Mon'],
    ['2', 'Tue'],
    ['3', 'Wed'],
    ['4', 'Thu'],
    ['5', 'Fri'],
    ['6', 'Sat'],
    ['0', 'Sun'],
]
