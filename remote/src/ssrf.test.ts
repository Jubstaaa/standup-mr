import { describe, expect, test } from 'bun:test'

import {
    createGuardedFetch,
    createGuardedLookup,
    createHostCheck,
    HostError,
    isPublicAddress,
    normalizeHost,
} from './ssrf'
import type { Lookup } from './ssrf'

function resolvesTo(...addresses: string[]): Lookup {
    return (_host, _options, callback) =>
        callback(
            null,
            addresses.map(address => ({
                address,
                family: address.includes(':') ? 6 : 4,
            }))
        )
}

describe('normalizeHost', () => {
    test('strips scheme, path and case', () => {
        expect(normalizeHost('https://Git.Example.com/group/')).toBe(
            'git.example.com'
        )
        expect(normalizeHost(' git.example.com ')).toBe('git.example.com')
    })

    test('rejects plain http, credentials and custom ports', () => {
        expect(() => normalizeHost('http://git.example.com')).toThrow(HostError)
        expect(() => normalizeHost('https://u:p@git.example.com')).toThrow(
            HostError
        )
        expect(() => normalizeHost('git.example.com:22')).toThrow(HostError)
    })
})

describe('isPublicAddress', () => {
    test('accepts public unicast', () => {
        expect(isPublicAddress('140.82.112.3')).toBe(true)
        expect(isPublicAddress('2606:4700::6810:84e5')).toBe(true)
    })

    test.each([
        '127.0.0.1',
        '10.1.2.3',
        '172.20.0.1',
        '192.168.1.1',
        '169.254.169.254',
        '100.64.0.1',
        '0.0.0.0',
        '198.18.0.1',
        '240.0.0.1',
        '::1',
        '::',
        'fd00::1',
        'fe80::1',
        '::ffff:127.0.0.1',
        '64:ff9b::7f00:1',
        '2002:7f00:1::',
        'not-an-ip',
    ])('refuses %s', address => {
        expect(isPublicAddress(address)).toBe(false)
    })

    test('refuses configured addresses such as the droplet itself', () => {
        expect(
            isPublicAddress('178.128.204.198', new Set(['178.128.204.198']))
        ).toBe(false)
    })
})

describe('createGuardedLookup', () => {
    test('passes public answers through in both lookup shapes', async () => {
        const lookup = createGuardedLookup([], resolvesTo('140.82.112.3'))
        const single = await new Promise(resolve =>
            lookup('github.com', {}, (_error, address) => resolve(address))
        )
        expect(single).toBe('140.82.112.3')
        const all = await new Promise(resolve =>
            lookup('github.com', { all: true }, (_error, address) =>
                resolve(address)
            )
        )
        expect(all).toEqual([{ address: '140.82.112.3', family: 4 }])
    })

    test('fails when any answer is private', async () => {
        const lookup = createGuardedLookup(
            [],
            resolvesTo('140.82.112.3', '10.0.0.1')
        )
        const error = await new Promise(resolve =>
            lookup('mixed.example.com', {}, failure => resolve(failure))
        )
        expect(error).toBeInstanceOf(HostError)
    })
})

describe('createHostCheck', () => {
    test('reports a private host and an unresolvable one', async () => {
        const privateCheck = createHostCheck(
            createGuardedLookup([], resolvesTo('127.0.0.1'))
        )
        await expect(privateCheck('evil.example.com')).rejects.toThrow(
            /private or reserved/
        )

        const missing = createHostCheck((_host, _options, callback) =>
            callback(new Error('ENOTFOUND'), [])
        )
        await expect(missing('nope.invalid')).rejects.toThrow(
            /Could not resolve/
        )
    })
})

describe('createGuardedFetch', () => {
    test('never connects when the host resolves privately', async () => {
        const guardedFetch = createGuardedFetch(
            createGuardedLookup([], resolvesTo('127.0.0.1'))
        )
        await expect(
            guardedFetch('https://rebind.example.com/api/v4/user')
        ).rejects.toThrow(/private or reserved/)
    })
})
