import { Cron } from 'croner'

import { collect } from '../../../mcp/server'
import { postWebhook } from '../../../src/notify/notify'
import { toMarkdown } from '../../../src/render/render'
import { describeAccount, providerFor } from '../accounts/accounts'
import { errorMessage } from '../errors/errors'
import type { Schedule, ScheduleSettings } from '../store/store.types'

import {
    CATCH_UP_LIMIT_MS,
    DAY_NAMES,
    EVERY_DAY,
    TICK_INTERVAL_MS,
    TIME_PATTERN,
    TIMEZONES,
    WEEKDAYS,
} from './schedule.constants'
import type { ScheduleForm, SchedulerDeps } from './schedule.types'

export class ScheduleError extends Error {}

export function parseSchedule(form: ScheduleForm): ScheduleSettings {
    if (!TIME_PATTERN.test(form.time)) {
        throw new ScheduleError('Pick a time as HH:MM.')
    }
    if (!TIMEZONES.includes(form.timezone)) {
        throw new ScheduleError('Pick a time zone from the list.')
    }
    const known = new Set(DAY_NAMES.map(([value]) => value))
    if (form.days.length === 0 || !form.days.every(day => known.has(day))) {
        throw new ScheduleError('Pick at least one day.')
    }
    const days = [...new Set(form.days)].sort().join(',')
    return { time: form.time, timezone: form.timezone, days }
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
export async function composeDigest(
    deps: SchedulerDeps,
    connectionId: string
): Promise<string> {
    const accounts = deps.store.listAccounts(connectionId)
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
        const markdown = toMarkdown(report)
        sections.push(
            accounts.length === 1
                ? markdown
                : `**${describeAccount(account)}**\n\n${markdown}`
        )
    }
    return sections.join('\n')
}

export async function sendDigest(
    deps: SchedulerDeps,
    connectionId: string
): Promise<void> {
    const webhook = deps.store.getWebhook(connectionId)
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
        deps.store.setNextRun(schedule.connectionId, next)
        return
    }
    deps.store.touchConnection(schedule.connectionId, now)
    try {
        await sendDigest(deps, schedule.connectionId)
        deps.store.markScheduleSent(schedule.connectionId, deps.now(), next)
    } catch (error) {
        deps.store.markScheduleFailed(
            schedule.connectionId,
            errorMessage(error),
            next
        )
    }
}

export async function runDueSchedules(deps: SchedulerDeps): Promise<void> {
    for (const schedule of deps.store.listDueSchedules(deps.now())) {
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
