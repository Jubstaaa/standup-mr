import { randomBytes } from 'node:crypto'

import { describe, expect, test } from 'bun:test'

import { hashToken, open, randomToken, seal } from './crypto'

const key = randomBytes(32)

describe('seal / open', () => {
    test('round-trips a value', () => {
        expect(open(key, seal(key, 'glpat-secret'))).toBe('glpat-secret')
    })

    test('never produces the same ciphertext twice', () => {
        expect(seal(key, 'same')).not.toBe(seal(key, 'same'))
    })

    test('rejects a tampered ciphertext', () => {
        const sealed = Buffer.from(seal(key, 'value'), 'base64')
        sealed[sealed.length - 1]! ^= 1
        expect(() => open(key, sealed.toString('base64'))).toThrow()
    })

    test('rejects the wrong key', () => {
        expect(() => open(randomBytes(32), seal(key, 'value'))).toThrow()
    })
})

test('hashToken is stable and not the input', () => {
    const token = randomToken()
    expect(hashToken(token)).toBe(hashToken(token))
    expect(hashToken(token)).not.toContain(token)
})
