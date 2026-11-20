import { randomBytes } from 'node:crypto'

import { beforeEach, describe, expect, spyOn, test } from 'bun:test'

import type { FetchLike } from '../../../src/standup.types'
import { AccountError, createTokenRefresher } from '../accounts/accounts'
import { Store } from '../store/store'
import { startConnection } from '../store/store.fixtures'

import {
    describeSchedule,
    nextRunAt,
    parseSchedule,
    runDueSchedules,
    startScheduler,
} from './schedule'
import { CATCH_UP_LIMIT_MS } from './schedule.constants'
import type { SchedulerDeps } from './schedule.types'

const WEBHOOK = 'https://hooks.slack.com/services/T/B/X'
const WEEKDAYS_0930 = {
    time: '09:30',
    timezone: 'Europe/Istanbul',
    days: '1,2,3,4,5',
}
// Monday 12 October 2026, 09:30 in Istanbul (UTC+3).
const MONDAY_0930 = Date.parse('2026-10-12T06:30:00Z')

let store: Store
let connectionId: string
let deps: SchedulerDeps
let posted: string[]
let clock: number

// Stands in for two GitLab hosts with no activity, and the Slack webhook.
const fakeFetch: FetchLike = async (url, init) => {
    if (url === WEBHOOK) {
        posted.push(String(init?.body))
        return new Response('ok')
    }
    if (url.endsWith('/api/v4/user')) {
        return Response.json({ id: 1, username: 'ilker' })
    }
    return Response.json([])
}

function linkGitLab(host: string): void {
    store.accounts.add({
        connectionId,
        provider: 'gitlab',
        host,
        username: 'ilker',
        source: 'pat',
        accessToken: 'glpat',
        refreshToken: null,
        expiresAt: null,
    })
}

beforeEach(() => {
    store = new Store(':memory:', randomBytes(32))
    connectionId = startConnection(store).connectionId
    posted = []
    clock = MONDAY_0930
    deps = {
        fetchImpl: fakeFetch,
        freshAccessToken: createTokenRefresher(
            { resolve: () => undefined, refresh: () => Promise.reject() },
            store.accounts
        ),
        now: () => clock,
        store,
    }
})

describe('nextRunAt', () => {
    test('finds the time in the chosen time zone', () => {
        const saturday = Date.parse('2026-10-17T12:00:00Z')
        expect(new Date(nextRunAt(WEEKDAYS_0930, saturday)).toISOString()).toBe(
            '2026-10-19T06:30:00.000Z'
        )
        const newYork = { ...WEEKDAYS_0930, timezone: 'America/New_York' }
        expect(new Date(nextRunAt(newYork, saturday)).toISOString()).toBe(
            '2026-10-19T13:30:00.000Z'
        )
    })

    test('moves past a run that is due now', () => {
        expect(nextRunAt(WEEKDAYS_0930, MONDAY_0930)).toBe(
            Date.parse('2026-10-13T06:30:00Z')
        )
    })
})

describe('parseSchedule', () => {
    const valid = {
        time: '09:30',
        timezone: 'Europe/Istanbul',
        days: ['5', '1', '1'],
    }

    test('keeps each day once, in order', () => {
        expect(parseSchedule(valid).days).toBe('1,5')
    })

    test.each([
        [{ ...valid, time: '9:30' }, /HH:MM/],
        [{ ...valid, time: '24:00' }, /HH:MM/],
        [{ ...valid, time: '09:30:00' }, /HH:MM/],
        [{ ...valid, timezone: 'Mars/Olympus' }, /time zone/],
        [{ ...valid, days: [] }, /one day/],
        [{ ...valid, days: ['7'] }, /one day/],
    ])('rejects %o', (form, message) => {
        expect(() => parseSchedule(form)).toThrow(message)
    })

    test('describes the schedule', () => {
        expect(describeSchedule(WEEKDAYS_0930)).toBe(
            'Posts weekdays at 09:30 Europe/Istanbul'
        )
        expect(describeSchedule({ ...WEEKDAYS_0930, days: '0,6' })).toBe(
            'Posts on Sat, Sun at 09:30 Europe/Istanbul'
        )
    })
})

describe('runDueSchedules', () => {
    beforeEach(() => {
        store.connections.setWebhook(connectionId, {
            kind: 'slack',
            url: WEBHOOK,
        })
        store.schedules.set(connectionId, WEEKDAYS_0930, MONDAY_0930)
    })

    test('posts one message with a section per account', async () => {
        linkGitLab('git.one.com')
        linkGitLab('git.two.com')
        await runDueSchedules(deps)

        expect(posted).toHaveLength(1)
        expect(posted[0]).toContain('gitlab · git.one.com · ilker')
        expect(posted[0]).toContain('gitlab · git.two.com · ilker')
        const schedule = store.schedules.get(connectionId)!
        expect(schedule.lastSentAt).toBe(MONDAY_0930)
        expect(schedule.lastError).toBeNull()
        expect(schedule.nextRunAt).toBe(Date.parse('2026-10-13T06:30:00Z'))
    })

    test('leaves schedules that are not due yet', async () => {
        linkGitLab('git.one.com')
        clock = MONDAY_0930 - 1
        await runDueSchedules(deps)
        expect(posted).toHaveLength(0)
        expect(store.schedules.get(connectionId)!.nextRunAt).toBe(MONDAY_0930)
    })

    test('skips a run missed by more than the catch-up limit', async () => {
        linkGitLab('git.one.com')
        clock = MONDAY_0930 + CATCH_UP_LIMIT_MS + 1
        await runDueSchedules(deps)

        expect(posted).toHaveLength(0)
        const schedule = store.schedules.get(connectionId)!
        expect(schedule.lastSentAt).toBeNull()
        expect(schedule.nextRunAt).toBe(Date.parse('2026-10-13T06:30:00Z'))
    })

    test('still sends a run that is a little late', async () => {
        linkGitLab('git.one.com')
        clock = MONDAY_0930 + CATCH_UP_LIMIT_MS
        await runDueSchedules(deps)
        expect(posted).toHaveLength(1)
    })

    test('records a failure and moves on', async () => {
        await runDueSchedules(deps)

        expect(posted).toHaveLength(0)
        const schedule = store.schedules.get(connectionId)!
        expect(schedule.lastError).toMatch(/No account is linked/)
        expect(schedule.nextRunAt).toBe(Date.parse('2026-10-13T06:30:00Z'))
    })

    test('records a webhook that rejects the post', async () => {
        linkGitLab('git.one.com')
        deps.fetchImpl = async (url, init) =>
            url === WEBHOOK
                ? new Response('gone', { status: 404 })
                : fakeFetch(url, init)
        await runDueSchedules(deps)
        expect(store.schedules.get(connectionId)!.lastError).toMatch(/HTTP 404/)
    })

    test('records a missing webhook', async () => {
        linkGitLab('git.one.com')
        store.connections.setWebhook(connectionId, undefined)
        await runDueSchedules(deps)
        expect(store.schedules.get(connectionId)!.lastError).toMatch(
            /No webhook/
        )
    })

    test('posts the accounts that worked and names the one that failed', async () => {
        linkGitLab('git.one.com')
        linkGitLab('git.bad.com')
        deps.fetchImpl = async (url, init) =>
            url.startsWith('https://git.bad.com/')
                ? new Response('down', { status: 500 })
                : fakeFetch(url, init)

        const logged = spyOn(console, 'error').mockImplementation(() => {})
        try {
            await runDueSchedules(deps)
            const line = logged.mock.calls.flat().join(' ')
            expect(line).toContain(connectionId)
            expect(line).toContain('gitlab · git.bad.com · ilker')
            expect(line).toContain('git.bad.com returned 500')
        } finally {
            logged.mockRestore()
        }

        expect(posted).toHaveLength(1)
        expect(posted[0]).toContain('gitlab · git.one.com · ilker')
        // The channel gets a fixed sentence, never the error text.
        expect(posted[0]).toContain('Could not read this account right now.')
        expect(posted[0]).not.toContain('500')
        const schedule = store.schedules.get(connectionId)!
        expect(schedule.lastError).toBeNull()
        expect(schedule.lastSentAt).toBe(MONDAY_0930)
        expect(schedule.lastWarning).toBe('1 of 2 accounts could not be read.')
    })

    test('a clean run clears an earlier warning', async () => {
        linkGitLab('git.one.com')
        store.schedules.markSent(connectionId, 1, MONDAY_0930, 'old warning')
        await runDueSchedules(deps)
        expect(store.schedules.get(connectionId)!.lastWarning).toBeNull()
    })

    test('records a failure when no account could be read', async () => {
        linkGitLab('git.bad.com')
        deps.fetchImpl = async (url, init) =>
            url.startsWith('https://git.bad.com/')
                ? new Response('down', { status: 500 })
                : fakeFetch(url, init)
        await runDueSchedules(deps)

        expect(posted).toHaveLength(0)
        expect(store.schedules.get(connectionId)!.lastError).toBe(
            'No linked account could be read.'
        )
    })

    test('records an expired login as the reason when every account has one', async () => {
        linkGitLab('git.one.com')
        deps.freshAccessToken = async () => {
            throw new AccountError('The login has expired. Reconnect.')
        }
        await runDueSchedules(deps)
        expect(store.schedules.get(connectionId)!.lastError).toMatch(/expired/)
    })

    test('advances and records a schedule whose next run cannot be found', async () => {
        linkGitLab('git.one.com')
        store.schedules.set(
            connectionId,
            { ...WEEKDAYS_0930, timezone: 'Mars/Olympus' },
            MONDAY_0930
        )
        const logged = spyOn(console, 'error').mockImplementation(() => {})
        try {
            await runDueSchedules(deps)
            expect(logged.mock.calls.flat().join(' ')).toContain(
                'retrying in 24 h'
            )
        } finally {
            logged.mockRestore()
        }

        const schedule = store.schedules.get(connectionId)!
        expect(schedule.lastError).toBeTruthy()
        expect(schedule.nextRunAt).toBeGreaterThan(MONDAY_0930)
    })

    test('gives up on a schedule that runs past its deadline', async () => {
        linkGitLab('git.one.com')
        deps.scheduleDeadlineMs = 50
        deps.fetchImpl = (url, init) =>
            url.startsWith('https://git.one.com/api/v4/user')
                ? fakeFetch(url, init)
                : new Promise((_resolve, reject) => {
                      const abort = () =>
                          reject(new Error('aborted by the deadline'))
                      if (init?.signal?.aborted) abort()
                      init?.signal?.addEventListener('abort', abort)
                  })
        const logged = spyOn(console, 'error').mockImplementation(() => {})
        try {
            await runDueSchedules(deps)
            expect(logged.mock.calls.flat().join(' ')).toContain(
                `schedule ${connectionId} failed`
            )
        } finally {
            logged.mockRestore()
        }

        expect(posted).toHaveLength(0)
        expect(store.schedules.get(connectionId)!.lastError).toBe(
            'The run took longer than 0.05 s and was stopped.'
        )
    })
})

describe('startScheduler', () => {
    test('stopping waits for the run in flight', async () => {
        store.connections.setWebhook(connectionId, {
            kind: 'slack',
            url: WEBHOOK,
        })
        store.schedules.set(connectionId, WEEKDAYS_0930, MONDAY_0930)
        linkGitLab('git.one.com')
        let release = () => {}
        let started = () => {}
        const running = new Promise<void>(resolve => (started = resolve))
        deps.fetchImpl = async (url, init) => {
            if (url === WEBHOOK) {
                started()
                await new Promise<void>(resolve => (release = resolve))
            }
            return fakeFetch(url, init)
        }
        const stop = startScheduler(deps, 5)
        await running

        let stopped = false
        const stopping = stop().then(() => (stopped = true))
        await Bun.sleep(20)
        expect(stopped).toBe(false)

        release()
        await stopping
        expect(posted).toHaveLength(1)
    })

    test('a failing tick is logged, not left as an unhandled rejection', async () => {
        const logged = spyOn(console, 'error').mockImplementation(() => {})
        const listDue = spyOn(store.schedules, 'listDue').mockImplementation(
            () => {
                throw new Error('SQLITE_BUSY')
            }
        )
        try {
            const stop = startScheduler(deps, 5)
            await Bun.sleep(30)
            await stop()
            expect(logged.mock.calls.flat().join(' ')).toContain(
                'scheduler tick failed: SQLITE_BUSY'
            )
        } finally {
            listDue.mockRestore()
            logged.mockRestore()
        }
    })

    test('stopping does not start the next due schedule', async () => {
        const other = startConnection(store, 0, 'other').connectionId
        for (const [id, host] of [
            [connectionId, 'git.one.com'],
            [other, 'git.two.com'],
        ] as const) {
            store.connections.setWebhook(id, { kind: 'slack', url: WEBHOOK })
            store.schedules.set(id, WEEKDAYS_0930, MONDAY_0930)
            store.accounts.add({
                connectionId: id,
                provider: 'gitlab',
                host,
                username: 'ilker',
                source: 'pat',
                accessToken: 'glpat',
                refreshToken: null,
                expiresAt: null,
            })
        }
        let started = () => {}
        const running = new Promise<void>(resolve => (started = resolve))
        const hosts = new Set<string>()
        deps.fetchImpl = (url, init) => {
            if (url.includes('/merge_requests')) {
                hosts.add(new URL(url).host)
                started()
                return new Promise((_resolve, reject) => {
                    const abort = () => reject(new Error('stopped'))
                    if (init?.signal?.aborted) abort()
                    init?.signal?.addEventListener('abort', abort)
                })
            }
            return fakeFetch(url, init)
        }
        const logged = spyOn(console, 'error').mockImplementation(() => {})
        try {
            const stop = startScheduler(deps, 5)
            await running
            await stop()
            expect(hosts.size).toBe(1)
        } finally {
            logged.mockRestore()
        }
        expect(posted).toHaveLength(0)
        const due = store.schedules.listDue(clock).map(s => s.connectionId)
        expect(due).toHaveLength(1)
    })
})
