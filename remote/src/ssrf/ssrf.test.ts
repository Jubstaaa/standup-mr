import { describe, expect, test } from 'bun:test'

import {
    blockedSet,
    createGuardedFetch,
    createGuardedLookup,
    createHostCheck,
    HostError,
    isPublicAddress,
    normalizeHost,
    redirectGuard,
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

    test('drops the trailing dot of a fully qualified name', () => {
        expect(normalizeHost('github.com.')).toBe('github.com')
        expect(normalizeHost('https://git.example.com./x')).toBe(
            'git.example.com'
        )
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
        '::7f00:1',
        'not-an-ip',
    ])('refuses %s', address => {
        expect(isPublicAddress(address)).toBe(false)
    })

    test('refuses configured addresses such as the droplet itself', () => {
        expect(
            isPublicAddress('178.128.204.198', blockedSet(['178.128.204.198']))
        ).toBe(false)
    })
})

describe('createGuardedLookup', () => {
    test('passes public answers through in both lookup shapes', async () => {
        const lookup = createGuardedLookup(
            new Set(),
            resolvesTo('140.82.112.3')
        )
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
            new Set(),
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
            createGuardedLookup(new Set(), resolvesTo('127.0.0.1'))
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
            createGuardedLookup(new Set(), resolvesTo('127.0.0.1'))
        )
        await expect(
            guardedFetch('https://rebind.example.com/api/v4/user')
        ).rejects.toThrow(/private or reserved/)
    })

    test.each([
        'https://127.0.0.1/api/v4/user',
        'https://[::1]/api/v4/user',
        'https://169.254.169.254/latest',
        'https://git.example.com:8080/api/v4/user',
        'http://git.example.com/api/v4/user',
    ])('refuses %s before dialling', async url => {
        const guardedFetch = createGuardedFetch(
            createGuardedLookup(new Set(), () => {
                throw new Error('lookup should not run')
            })
        )
        await expect(guardedFetch(url)).rejects.toThrow(HostError)
    })
})

// follow-redirects hands beforeRedirect the next hop as http.request options;
// a public host answering 30x must not steer the server inward.
describe('redirectGuard', () => {
    const guard = redirectGuard(blockedSet(['8.8.4.4']))
    const hop = (hostname: string, port = '', protocol = 'https:') => ({
        hostname,
        port,
        protocol,
    })

    test('lets a public https hop through', () => {
        expect(() => guard(hop('gitlab.example.com'))).not.toThrow()
        expect(() => guard(hop('140.82.112.3', '443'))).not.toThrow()
    })

    test.each([
        ['plain http', hop('gitlab.example.com', '', 'http:')],
        ['a custom port', hop('gitlab.example.com', '8443')],
        ['loopback', hop('127.0.0.1')],
        ['cloud metadata', hop('169.254.169.254')],
        ['bracketed IPv6 loopback', hop('[::1]')],
        ['a blocked public address', hop('8.8.4.4')],
    ])('refuses %s', (_name, target) => {
        expect(() => guard(target)).toThrow(HostError)
    })
})
