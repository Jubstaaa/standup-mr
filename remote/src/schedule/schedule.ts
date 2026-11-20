import { Cron } from 'croner'
import { z } from 'zod'

import { postWebhook } from '../../../src/notify/notify'
import { toChatDigest } from '../../../src/render/digest'
import { collect } from '../../../src/report/report'
import { describeAccount, providerFor } from '../accounts/accounts'
import { errorMessage } from '../errors/errors'
import type { Schedule, ScheduleSettings } from '../store/store.types'

import {
    CATCH_UP_LIMIT_MS,
    DAY_NAMES,
    EVERY_DAY,
    TICK_INTERVAL_MS,
    TIMEZONES,
    WEEKDAYS,
} from './schedule.constants'
import type { ScheduleForm, SchedulerDeps } from './schedule.types'

export class ScheduleError extends Error {}

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
        throw new ScheduleError(parsed.error.issues[0]!.message)
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
    if (!next) throw new ScheduleError('The schedule never runs.')
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

// One message for the whole connection: a section per linked account.
async function composeDigest(
    deps: SchedulerDeps,
    connectionId: string
): Promise<string> {
    const accounts = deps.store.accounts.list(connectionId)
    if (accounts.length === 0) {
        throw new ScheduleError('No account is linked.')
    }
    const sections: string[] = []
    for (const account of accounts) {
        const token = await deps.freshAccessToken(account, deps.now())
        const report = await collect({
            providerImpl: providerFor(
                account.provider,
                account.host,
                token,
                deps.fetchImpl
            ),
        })
        const digest = toChatDigest(report)
        sections.push(
            accounts.length === 1
                ? digest
                : `**${describeAccount(account)}**\n${digest}`
        )
    }
    return sections.join('\n')
}

export async function sendDigest(
    deps: SchedulerDeps,
    connectionId: string
): Promise<void> {
    const webhook = deps.store.connections.getWebhook(connectionId)
    if (!webhook) throw new ScheduleError('No webhook is saved.')
    const text = await composeDigest(deps, connectionId)
    await postWebhook(webhook.url, text, webhook.kind, deps.fetchImpl)
}

async function runSchedule(
    deps: SchedulerDeps,
    schedule: Schedule
): Promise<void> {
    const now = deps.now()
    const next = nextRunAt(schedule, now)
    if (now - schedule.nextRunAt > CATCH_UP_LIMIT_MS) {
        deps.store.schedules.setNextRun(schedule.connectionId, next)
        return
    }
    deps.store.connections.touch(schedule.connectionId, now)
    try {
        await sendDigest(deps, schedule.connectionId)
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
// cannot make the same schedule post twice.
export function startScheduler(deps: SchedulerDeps): () => void {
    let running = false
    const timer = setInterval(() => {
        if (running) return
        running = true
        void runDueSchedules(deps).finally(() => {
            running = false
        })
    }, TICK_INTERVAL_MS)
    timer.unref()
    return () => clearInterval(timer)
}
