import { describe, expect, spyOn, test } from 'bun:test'

import { AccountError } from '../accounts/accounts'
import { ScheduleError } from '../schedule/schedule'
import { HostError } from '../ssrf/ssrf'

import { digestErrorCode, hostErrorCode } from './connect-errors'

function logged(run: () => unknown): { result: unknown; lines: string } {
    const spy = spyOn(console, 'error').mockImplementation(() => {})
    try {
        return { result: run(), lines: spy.mock.calls.flat().join(' ') }
    } finally {
        spy.mockRestore()
    }
}

describe('hostErrorCode', () => {
    test('uses the code a HostError carries, quietly', () => {
        const { result, lines } = logged(() =>
            hostErrorCode(new HostError('bad', 'host-port'))
        )
        expect(result).toBe('host-port')
        expect(lines).toBe('')
    })

    test('logs anything else before falling back', () => {
        const { result, lines } = logged(() =>
            hostErrorCode(new Error('EAI_AGAIN'), 'token-rejected')
        )
        expect(result).toBe('token-rejected')
        expect(lines).toContain('EAI_AGAIN')
    })
})

describe('digestErrorCode', () => {
    test.each([
        [new AccountError('expired'), 'account-expired'],
        [
            new ScheduleError('none', 'schedule-no-webhook'),
            'schedule-no-webhook',
        ],
        [
            new ScheduleError('none', 'schedule-accounts-unreadable'),
            'schedule-accounts-unreadable',
        ],
    ])('maps %p', (error, code) => {
        expect(logged(() => digestErrorCode(error)).result).toBe(code)
    })

    test('logs an unexpected failure and calls it a failed test', () => {
        const { result, lines } = logged(() =>
            digestErrorCode(new Error('HTTP 404 from hooks.slack.com'))
        )
        expect(result).toBe('test-failed')
        expect(lines).toContain('HTTP 404')
    })
})
