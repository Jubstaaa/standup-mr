import { Cron } from 'croner'
import { z } from 'zod'

import { postWebhook } from '../../../src/notify/notify'
import { toChatDigest } from '../../../src/render/digest'
import { collect } from '../../../src/report/report'
import type { FetchLike } from '../../../src/standup.types'
import { describeAccount, providerFor } from '../accounts/accounts'
import { errorMessage } from '../errors/errors'
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
    | 'schedule-days'
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
            FIELD_CODES[String(issue.path[0])] ?? 'schedule-time'
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

// One message for the whole connection: a section per linked account. An
// account that cannot be read gets a line saying so instead of costing
// everyone else's section; only when none can be read does the run fail.
async function composeDigest(
    deps: SchedulerDeps,
    connectionId: string
): Promise<string> {
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
    const firstFailure = results.find(result => result.status === 'rejected')
    if (firstFailure && results.every(result => result.status === 'rejected')) {
        throw firstFailure.reason
    }
    const sections = results.map(result =>
        result.status === 'fulfilled'
            ? result.value
            : `Could not read this account: ${errorMessage(result.reason)}`
    )
    return accounts.length === 1
        ? sections[0]!
        : sections
              .map(
                  (section, index) =>
                      `**${describeAccount(accounts[index]!)}**\n${section}`
              )
              .join('\n')
}

export async function sendDigest(
    deps: SchedulerDeps,
    connectionId: string
): Promise<void> {
    const webhook = deps.store.connections.getWebhook(connectionId)
    if (!webhook)
        throw new ScheduleError('No webhook is saved.', 'schedule-no-webhook')
    const text = await composeDigest(deps, connectionId)
    await postWebhook(webhook.url, text, webhook.kind, deps.fetchImpl)
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

async function runSchedule(
    deps: SchedulerDeps,
    schedule: Schedule
): Promise<void> {
    const now = deps.now()
    let next = now + BROKEN_SCHEDULE_RETRY_MS
    try {
        next = nextRunAt(schedule, now)
        if (now - schedule.nextRunAt > CATCH_UP_LIMIT_MS) {
            deps.store.schedules.setNextRun(schedule.connectionId, next)
            return
        }
        deps.store.connections.touch(schedule.connectionId, now)
        const deadline = AbortSignal.timeout(
            deps.scheduleDeadlineMs ?? SCHEDULE_DEADLINE_MS
        )
        await sendDigest(
            { ...deps, fetchImpl: withDeadline(deps.fetchImpl, deadline) },
            schedule.connectionId
        )
        deps.store.schedules.markSent(schedule.connectionId, deps.now(), next)
    } catch (error) {
        deps.store.schedules.markFailed(
            schedule.connectionId,
            errorMessage(error),
            next
        )
    }
}

export async function runDueSchedules(deps: SchedulerDeps): Promise<void> {
    for (const schedule of deps.store.schedules.listDue(deps.now())) {
        try {
            await runSchedule(deps, schedule)
        } catch (error) {
            console.error(
                `schedule ${schedule.connectionId}: ${errorMessage(error)}`
            )
        }
    }
}

// A tick is skipped while the previous one is still sending, so a slow host
// cannot make the same schedule post twice. Stopping waits for that tick.
export function startScheduler(
    deps: SchedulerDeps,
    tickMs = TICK_INTERVAL_MS
): () => Promise<void> {
    let running: Promise<void> | undefined
    const timer = setInterval(() => {
        if (running) return
        running = runDueSchedules(deps).finally(() => {
            running = undefined
        })
    }, tickMs)
    timer.unref()
    return async () => {
        clearInterval(timer)
        await running
    }
}
