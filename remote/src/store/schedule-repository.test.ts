import { randomBytes } from 'node:crypto'

import { beforeEach, describe, expect, test } from 'bun:test'

import { Store } from './store'
import { startConnection } from './store.fixtures'
import type { ScheduleSettings } from './store.types'

const SETTINGS: ScheduleSettings = {
    days: '1-5',
    time: '09:00',
    timezone: 'Europe/Istanbul',
}

let store: Store
let connectionId: string

beforeEach(() => {
    store = new Store(':memory:', randomBytes(32))
    connectionId = startConnection(store).connectionId
    store.schedules.set(connectionId, SETTINGS, 100)
})

describe('ScheduleRepository', () => {
    test('claims a due run once, then only for the run it now holds', () => {
        expect(store.schedules.claim(connectionId, 100, 200)).toBe(true)
        expect(store.schedules.claim(connectionId, 100, 200)).toBe(false)
        expect(store.schedules.get(connectionId)!.nextRunAt).toBe(200)
        expect(store.schedules.claim(connectionId, 200, 300)).toBe(true)
    })

    test('stores the settings and the next run', () => {
        expect(store.schedules.get(connectionId)).toEqual({
            ...SETTINGS,
            connectionId,
            lastError: null,
            lastSentAt: null,
            lastWarning: null,
            nextRunAt: 100,
        })
    })

    test('lists only the schedules that are due, soonest first', () => {
        const other = startConnection(store, 0, 'other').connectionId
        store.schedules.set(other, SETTINGS, 50)
        expect(store.schedules.listDue(100).map(s => s.connectionId)).toEqual([
            other,
            connectionId,
        ])
        expect(store.schedules.listDue(99).map(s => s.connectionId)).toEqual([
            other,
        ])
    })

    test('records a failure and clears it on success', () => {
        store.schedules.markFailed(connectionId, 'boom', 200)
        expect(store.schedules.get(connectionId)).toMatchObject({
            lastError: 'boom',
            nextRunAt: 200,
        })
        store.schedules.markSent(connectionId, 250, 300, null)
        expect(store.schedules.get(connectionId)).toMatchObject({
            lastError: null,
            lastSentAt: 250,
            nextRunAt: 300,
        })
    })

    test('changing the settings clears the last error', () => {
        store.schedules.markFailed(connectionId, 'boom', 200)
        store.schedules.set(connectionId, { ...SETTINGS, time: '10:00' }, 400)
        expect(store.schedules.get(connectionId)).toMatchObject({
            lastError: null,
            nextRunAt: 400,
            time: '10:00',
        })
    })

    test('deletes the schedule', () => {
        store.schedules.delete(connectionId)
        expect(store.schedules.get(connectionId)).toBeUndefined()
    })
})
