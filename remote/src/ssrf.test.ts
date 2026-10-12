import { describe, expect, test } from 'bun:test'

import { createHostGuard, HostError, normalizeHost } from './ssrf'

function resolvesTo(...addresses: string[]) {
    return async () =>
        addresses.map(address => ({
            address,
            family: address.includes(':') ? 6 : 4,
        }))
}

describe('normalizeHost', () => {
    test('strips scheme, path and case', () => {
        expect(normalizeHost('https://Git.Example.com/group/')).toBe(
            'git.example.com'
        )
        expect(normalizeHost(' git.example.com ')).toBe('git.example.com')
    })

    test('keeps a port', () => {
        expect(normalizeHost('git.example.com:8443')).toBe(
            'git.example.com:8443'
        )
    })

    test('rejects plain http and embedded credentials', () => {
        expect(() => normalizeHost('http://git.example.com')).toThrow(HostError)
        expect(() => normalizeHost('https://u:p@git.example.com')).toThrow(
            HostError
        )
    })
})

describe('assertPublicHost', () => {
    test('allows a public address', async () => {
        const guard = createHostGuard([], resolvesTo('140.82.112.3'))
        await guard('github.example.com')
    })

    test.each([
        '127.0.0.1',
        '10.1.2.3',
        '172.20.0.1',
        '192.168.1.1',
        '169.254.169.254',
        '::1',
        'fd00::1',
        '::ffff:127.0.0.1',
    ])('blocks %s', async address => {
        const guard = createHostGuard([], resolvesTo(address))
        await expect(guard('evil.example.com')).rejects.toThrow(HostError)
    })

    test('blocks when any resolved address is private', async () => {
        const guard = createHostGuard(
            [],
            resolvesTo('140.82.112.3', '10.0.0.1')
        )
        await expect(guard('mixed.example.com')).rejects.toThrow(HostError)
    })

    test('blocks IP literals without a lookup', async () => {
        const guard = createHostGuard([], async () => {
            throw new Error('lookup should not run')
        })
        await expect(guard('127.0.0.1')).rejects.toThrow(HostError)
    })

    test('blocks configured addresses such as the droplet itself', async () => {
        const guard = createHostGuard(
            ['178.128.204.198'],
            resolvesTo('178.128.204.198')
        )
        await expect(guard('standup.example.com')).rejects.toThrow(HostError)
    })

    test('reports a host that does not resolve', async () => {
        const guard = createHostGuard([], async () => {
            throw new Error('ENOTFOUND')
        })
        await expect(guard('nope.invalid')).rejects.toThrow(/Could not resolve/)
    })
})
