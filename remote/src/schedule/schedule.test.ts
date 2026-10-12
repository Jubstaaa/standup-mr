import { randomBytes } from 'node:crypto'

import { beforeEach, describe, expect, test } from 'bun:test'

import type { FetchLike } from '../../../src/types/standup.types'
import { createTokenRefresher } from '../accounts/accounts'
import { Store } from '../store/store'
import { startConnection } from '../store/store.fixtures'

import {
    describeSchedule,
    nextRunAt,
    parseSchedule,
    runDueSchedules,
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
    store.addAccount({
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
            store
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
        store.setWebhook(connectionId, { kind: 'slack', url: WEBHOOK })
        store.setSchedule(connectionId, WEEKDAYS_0930, MONDAY_0930)
    })

    test('posts one message with a section per account', async () => {
        linkGitLab('git.one.com')
        linkGitLab('git.two.com')
        await runDueSchedules(deps)

        expect(posted).toHaveLength(1)
        expect(posted[0]).toContain('gitlab · git.one.com · ilker')
        expect(posted[0]).toContain('gitlab · git.two.com · ilker')
        const schedule = store.getSchedule(connectionId)!
        expect(schedule.lastSentAt).toBe(MONDAY_0930)
        expect(schedule.lastError).toBeNull()
        expect(schedule.nextRunAt).toBe(Date.parse('2026-10-13T06:30:00Z'))
    })

    test('leaves schedules that are not due yet', async () => {
        linkGitLab('git.one.com')
        clock = MONDAY_0930 - 1
        await runDueSchedules(deps)
        expect(posted).toHaveLength(0)
        expect(store.getSchedule(connectionId)!.nextRunAt).toBe(MONDAY_0930)
    })

    test('skips a run missed by more than the catch-up limit', async () => {
        linkGitLab('git.one.com')
        clock = MONDAY_0930 + CATCH_UP_LIMIT_MS + 1
        await runDueSchedules(deps)

        expect(posted).toHaveLength(0)
        const schedule = store.getSchedule(connectionId)!
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
        const schedule = store.getSchedule(connectionId)!
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
        expect(store.getSchedule(connectionId)!.lastError).toMatch(/HTTP 404/)
    })

    test('records a missing webhook', async () => {
        linkGitLab('git.one.com')
        store.setWebhook(connectionId, undefined)
        await runDueSchedules(deps)
        expect(store.getSchedule(connectionId)!.lastError).toMatch(/No webhook/)
    })
})
