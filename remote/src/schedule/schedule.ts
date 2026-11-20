import { Cron } from 'croner'
import { z } from 'zod'

import { postWebhook } from '../../../src/notify/notify'
import { toChatDigest } from '../../../src/render/digest'
import { collect } from '../../../src/report/report'
import type { FetchLike } from '../../../src/standup.types'
import {
    AccountError,
    describeAccount,
    providerFor,
} from '../accounts/accounts'
import { errorDetail, errorMessage } from '../errors/errors'
import type { Schedule, ScheduleSettings } from '../store/store.types'

import {
    BROKEN_SCHEDULE_RETRY_MS,
    CATCH_UP_LIMIT_MS,
    DAY_NAMES,
    EVERY_DAY,
    SCHEDULE_DEADLINE_MS,
    TICK_INTERVAL_MS,
    TIMEZONES,
    WEEKDAYS,
} from './schedule.constants'
import type { ScheduleForm, SchedulerDeps } from './schedule.types'

export type ScheduleErrorCode =
    | 'schedule-accounts-unreadable'
    | 'schedule-days'
    | 'schedule-invalid'
    | 'schedule-never'
    | 'schedule-no-account'
    | 'schedule-no-webhook'
    | 'schedule-time'
    | 'schedule-timezone'

// code says what is wrong without the text, for pages that show a fixed
// message per code.
export class ScheduleError extends Error {
    constructor(
        message: string,
        readonly code: ScheduleErrorCode
    ) {
        super(message)
    }
}

const FIELD_CODES: Record<string, ScheduleErrorCode> = {
    days: 'schedule-days',
    time: 'schedule-time',
    timezone: 'schedule-timezone',
}

const NO_DAY = 'Pick at least one day.'

const scheduleForm = z.object({
    time: z.iso.time({ error: 'Pick a time as HH:MM.', precision: -1 }),
    timezone: z.enum(TIMEZONES, { error: 'Pick a time zone from the list.' }),
    days: z
        .array(
            z.enum(
                DAY_NAMES.map(([value]) => value),
                { error: NO_DAY }
            ),
            { error: NO_DAY }
        )
        .min(1, { error: NO_DAY }),
})

export function parseSchedule(form: ScheduleForm): ScheduleSettings {
    const parsed = scheduleForm.safeParse(form)
    if (!parsed.success) {
        const issue = parsed.error.issues[0]!
        throw new ScheduleError(
            issue.message,
            FIELD_CODES[String(issue.path[0])] ?? 'schedule-invalid'
        )
    }
    const { days, time, timezone } = parsed.data
    return { time, timezone, days: [...new Set(days)].sort().join(',') }
}

export function nextRunAt(settings: ScheduleSettings, after: number): number {
    const [hour, minute] = settings.time.split(':')
    const cron = new Cron(`${minute} ${hour} * * ${settings.days}`, {
        timezone: settings.timezone,
    })
    const next = cron.nextRun(new Date(after))
    if (!next)
        throw new ScheduleError('The schedule never runs.', 'schedule-never')
    return next.getTime()
}

export function describeSchedule(settings: ScheduleSettings): string {
    const selected = settings.days.split(',')
    const named = DAY_NAMES.filter(([value]) => selected.includes(value))
        .map(([, name]) => name)
        .join(', ')
    const days =
        settings.days === WEEKDAYS
            ? 'weekdays'
            : settings.days === EVERY_DAY
              ? 'every day'
              : `on ${named}`
    return `Posts ${days} at ${settings.time} ${settings.timezone}`
}

// The channel sees this fixed sentence for an account that could not be
// read; the reason, which can name internal hosts, only goes to the log.
const UNREADABLE_ACCOUNT = 'Could not read this account right now.'

interface Digest {
    text: string
    // Set when the digest left out accounts that could not be read.
    warning: string | null
}

// One message for the whole connection: a section per linked account. An
// account that cannot be read gets a line saying so instead of costing
// everyone else's section; only when none can be read does the run fail.
async function composeDigest(
    deps: SchedulerDeps,
    connectionId: string
): Promise<Digest> {
    const accounts = deps.store.accounts.list(connectionId)
    if (accounts.length === 0) {
        throw new ScheduleError('No account is linked.', 'schedule-no-account')
    }
    const results = await Promise.allSettled(
        accounts.map(async account => {
            const token = await deps.freshAccessToken(account, deps.now())
            const report = await collect({
                providerImpl: providerFor(
                    account.provider,
                    account.host,
                    token,
                    deps.fetchImpl
                ),
            })
            return toChatDigest(report)
        })
    )
    const failures: unknown[] = []
    results.forEach((result, index) => {
        if (result.status === 'fulfilled') return
        failures.push(result.reason)
        console.error(
            `schedule ${connectionId}: ${describeAccount(accounts[index]!)} could not be read: ${errorDetail(result.reason)}`
        )
    })
    if (failures.length === accounts.length) {
        // An expired login is the one failure the user can fix themselves.
        const expired = failures.find(error => error instanceof AccountError)
        throw (
            expired ??
            new ScheduleError(
                'No linked account could be read.',
                'schedule-accounts-unreadable'
            )
        )
    }
    const sections = results.map(result =>
        result.status === 'fulfilled' ? result.value : UNREADABLE_ACCOUNT
    )
    const text =
        accounts.length === 1
            ? sections[0]!
            : sections
                  .map(
                      (section, index) =>
                          `**${describeAccount(accounts[index]!)}**\n${section}`
                  )
                  .join('\n')
    const warning = failures.length
        ? `${failures.length} of ${accounts.length} accounts could not be read.`
        : null
    return { text, warning }
}

// Returns the warning for accounts the digest had to leave out, if any.
export async function sendDigest(
    deps: SchedulerDeps,
    connectionId: string
): Promise<string | null> {
    const webhook = deps.store.connections.getWebhook(connectionId)
    if (!webhook)
        throw new ScheduleError('No webhook is saved.', 'schedule-no-webhook')
    const digest = await composeDigest(deps, connectionId)
    await postWebhook(webhook.url, digest.text, webhook.kind, deps.fetchImpl)
    return digest.warning
}

// Every request a run makes carries the run's deadline, so one slow host
// cannot hold up the schedules queued behind it.
function withDeadline(fetchImpl: FetchLike, deadline: AbortSignal): FetchLike {
    return (url, init) =>
        fetchImpl(url, {
            ...init,
            signal: init?.signal
                ? AbortSignal.any([deadline, init.signal])
                : deadline,
        })
}

function describeDuration(ms: number): string {
    return ms >= 60_000 ? `${ms / 60_000} min` : `${ms / 1000} s`
}

async function runSchedule(
    deps: SchedulerDeps,
    schedule: Schedule,
    stopping: AbortSignal
): Promise<void> {
    const { connectionId } = schedule
    const now = deps.now()
    let next: number
    try {
        next = nextRunAt(schedule, now)
    } catch (error) {
        console.error(
            `schedule ${connectionId}: next run could not be computed (${errorDetail(error)}); retrying in 24 h`
        )
        deps.store.schedules.markFailed(
            connectionId,
            errorMessage(error),
            now + BROKEN_SCHEDULE_RETRY_MS
        )
        return
    }
    // Moving next_run_at only if it still holds this run makes the claim
    // atomic, so two servers sharing the database never post it twice.
    if (!deps.store.schedules.claim(connectionId, schedule.nextRunAt, next)) {
        return
    }
    if (now - schedule.nextRunAt > CATCH_UP_LIMIT_MS) {
        deps.store.schedules.markFailed(
            connectionId,
            `Skipped: the server was busy or down at the scheduled time and the run was over ${describeDuration(CATCH_UP_LIMIT_MS)} late.`,
            next
        )
        return
    }
    deps.store.connections.touch(connectionId, now)
    const deadlineMs = deps.scheduleDeadlineMs ?? SCHEDULE_DEADLINE_MS
    const deadline = AbortSignal.timeout(deadlineMs)
    try {
        const warning = await sendDigest(
            {
                ...deps,
                fetchImpl: withDeadline(
                    deps.fetchImpl,
                    AbortSignal.any([deadline, stopping])
                ),
            },
            connectionId
        )
        deps.store.schedules.markSent(connectionId, deps.now(), next, warning)
    } catch (error) {
        console.error(`schedule ${connectionId} failed: ${errorDetail(error)}`)
        const reason = deadline.aborted
            ? `The run took longer than ${describeDuration(deadlineMs)} and was stopped.`
            : stopping.aborted
              ? 'The server was restarting during this run.'
              : errorMessage(error)
        deps.store.schedules.markFailed(connectionId, reason, next)
    }
}

// Stops between schedules once stopping is aborted, so a shutdown never
// starts another post it may not live to record.
export async function runDueSchedules(
    deps: SchedulerDeps,
    stopping: AbortSignal = new AbortController().signal
): Promise<void> {
    for (const schedule of deps.store.schedules.listDue(deps.now())) {
        if (stopping.aborted) return
        try {
            await runSchedule(deps, schedule, stopping)
        } catch (error) {
            console.error(
                `schedule ${schedule.connectionId}: ${errorDetail(error)}`
            )
        }
    }
}

// A tick is skipped while the previous one is still sending, so a slow host
// cannot make the same schedule post twice. Stopping cancels the run in
// flight and waits for it to record its outcome.
export function startScheduler(
    deps: SchedulerDeps,
    tickMs = TICK_INTERVAL_MS
): () => Promise<void> {
    const stop = new AbortController()
    let running: Promise<void> | undefined
    const timer = setInterval(() => {
        if (running) return
        running = runDueSchedules(deps, stop.signal)
            .catch((error: unknown) => {
                console.error(`scheduler tick failed: ${errorDetail(error)}`)
            })
            .finally(() => {
                running = undefined
            })
    }, tickMs)
    timer.unref()
    return async () => {
        clearInterval(timer)
        stop.abort()
        await running
    }
}
