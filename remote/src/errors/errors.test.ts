import { describe, expect, test } from 'bun:test'

import { errorDetail } from './errors'

describe('errorDetail', () => {
    test('follows the cause chain for a log line', () => {
        const error = new Error('Schema migration 2 failed', {
            cause: new Error('no such table: instances', {
                cause: 'SQLITE_ERROR',
            }),
        })
        expect(errorDetail(error)).toBe(
            'Schema migration 2 failed <- no such table: instances <- SQLITE_ERROR'
        )
    })

    test('stops on a cause that points back at itself', () => {
        const error = new Error('loop')
        error.cause = error
        expect(errorDetail(error)).toBe('loop')
    })
})
