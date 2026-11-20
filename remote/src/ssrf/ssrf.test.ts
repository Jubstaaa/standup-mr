import type { Readable } from 'node:stream'

import axios from 'axios'
import type { AxiosResponse } from 'axios'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import pLimit from 'p-limit'

import {
    blockedSet,
    createGuardedFetch,
    createGuardedLookup,
    createHostCheck,
    guardedRequestConfig,
    HostError,
    isPublicAddress,
    normalizeHost,
    redirectGuard,
    toFetchResponse,
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
    // Telling the two apart would let anyone map internal DNS names.
    test('refuses a private host and an unresolvable one alike', async () => {
        const privateCheck = createHostCheck(
            createGuardedLookup(new Set(), resolvesTo('127.0.0.1'))
        )
        const missing = createHostCheck((_host, _options, callback) =>
            callback(new Error('ENOTFOUND'), [])
        )
        const refusals = await Promise.all([
            privateCheck('a.example.com').catch((error: unknown) => error),
            missing('a.example.com').catch((error: unknown) => error),
        ])
        for (const refusal of refusals) {
            expect(refusal).toBeInstanceOf(HostError)
            expect(refusal).toMatchObject({
                code: 'host-unreachable',
                message: 'a.example.com could not be reached as a public host.',
            })
        }
    })

    test('names what is wrong with a host that cannot be used', () => {
        const codeOf = (input: string) => {
            try {
                normalizeHost(input)
            } catch (error) {
                return error instanceof HostError ? error.code : 'other'
            }
            return 'none'
        }
        expect(codeOf('http://git.example.com')).toBe('host-not-https')
        expect(codeOf('https://u:p@git.example.com')).toBe('host-credentials')
        expect(codeOf('git.example.com:22')).toBe('host-port')
        expect(codeOf('https://')).toBe('host-invalid')
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

const MIB = 1024 * 1024

describe('guardedRequestConfig and toFetchResponse', () => {
    let server: ReturnType<typeof Bun.serve>
    // Bytes the local host has produced for /endless, so a test can tell
    // whether the client read a body whole or stopped early.
    let produced = 0

    beforeAll(() => {
        server = Bun.serve({
            port: 0,
            hostname: '127.0.0.1',
            fetch(request) {
                const path = new URL(request.url).pathname
                if (path === '/sized') {
                    const total = Number(
                        new URL(request.url).searchParams.get('bytes')
                    )
                    let sent = 0
                    return new Response(
                        new ReadableStream({
                            pull(controller) {
                                const size = Math.min(256 * 1024, total - sent)
                                if (size <= 0) return controller.close()
                                sent += size
                                controller.enqueue(new Uint8Array(size))
                            },
                        })
                    )
                }
                if (path === '/endless') {
                    produced = 0
                    return new Response(
                        new ReadableStream({
                            pull(controller) {
                                produced += 64 * 1024
                                controller.enqueue(new Uint8Array(64 * 1024))
                            },
                        })
                    )
                }
                if (path === '/empty')
                    return new Response(null, { status: 204 })
                // Trickles a byte every 20ms forever: the idle timeout never
                // fires, only a total deadline ends it.
                const body = new ReadableStream({
                    async pull(controller) {
                        await Bun.sleep(20)
                        controller.enqueue(new Uint8Array(1))
                    },
                })
                return new Response(body)
            },
        })
    })

    afterAll(() => server.stop(true))

    // The real config, sent over plain http to a local server: only the
    // SSRF-specific pieces (https, lookup, redirect guard) are left out.
    async function send(
        path: string,
        options: {
            deadlineMs?: number
            downloads?: ReturnType<typeof pLimit>
            init?: RequestInit
            maxResponseBytes?: number
        } = {}
    ): Promise<Response> {
        const config = guardedRequestConfig(
            'https://git.example.com/',
            options.init,
            resolvesTo('140.82.112.3'),
            new Set(),
            options.deadlineMs
        )
        const response: AxiosResponse<Readable> = await axios.request({
            ...config,
            url: `http://127.0.0.1:${server.port}${path}`,
            lookup: undefined,
            beforeRedirect: undefined,
        })
        return toFetchResponse(response, {
            downloads: options.downloads ?? pLimit(4),
            maxResponseBytes: options.maxResponseBytes ?? Infinity,
        })
    }

    async function byteCount(response: Response): Promise<number> {
        let total = 0
        for await (const chunk of response.body!) total += chunk.byteLength
        return total
    }

    test('streams a body past the old 10 MiB cap, so a long log keeps its tail', async () => {
        const response = await send(`/sized?bytes=${12 * MIB}`)
        expect(await byteCount(response)).toBe(12 * MIB)
    })

    test('refuses a body past the cap without downloading it whole', async () => {
        const response = await send('/endless', { maxResponseBytes: MIB })
        await expect(response.arrayBuffer()).rejects.toThrow(/more than/)
        await Bun.sleep(50)
        expect(produced).toBeLessThan(16 * MIB)
    })

    test('gives a null-body status no body', async () => {
        const response = await send('/empty')
        expect(response.status).toBe(204)
        expect(response.body).toBeNull()
    })

    test('lets no more bodies download at once than the limit', async () => {
        const downloads = pLimit(1)
        const first = await send(`/sized?bytes=${MIB}`, { downloads })
        const second = await send(`/sized?bytes=${MIB}`, { downloads })
        const firstReader = first.body!.getReader()
        await firstReader.read()

        let secondDone = false
        const secondRead = byteCount(second).then(bytes => {
            secondDone = true
            return bytes
        })
        await Bun.sleep(100)
        expect(secondDone).toBe(false)

        await firstReader.cancel()
        expect(await secondRead).toBe(MIB)
    })

    test('a body nobody reads holds no download slot', async () => {
        const downloads = pLimit(1)
        await send(`/sized?bytes=${MIB}`, { downloads })
        const read = await send(`/sized?bytes=${MIB}`, { downloads })
        expect(await byteCount(read)).toBe(MIB)
    })

    test('ends a response that trickles past the total deadline', async () => {
        const started = Date.now()
        const response = await send('/trickle', { deadlineMs: 150 })
        await expect(response.arrayBuffer()).rejects.toThrow()
        expect(Date.now() - started).toBeLessThan(2_000)
    })

    test("honours the caller's abort signal", async () => {
        const controller = new AbortController()
        const response = await send('/trickle', {
            init: { signal: controller.signal },
        })
        setTimeout(() => controller.abort(), 50)
        await expect(response.arrayBuffer()).rejects.toThrow()
    })
})

describe('createGuardedFetch signal', () => {
    test('never dials when the signal is already aborted', async () => {
        let looked = false
        const guardedFetch = createGuardedFetch((_host, _options, callback) => {
            looked = true
            callback(null, [{ address: '140.82.112.3', family: 4 }])
        })
        await expect(
            guardedFetch('https://git.example.com/', {
                signal: AbortSignal.abort(),
            })
        ).rejects.toThrow(/cancel|abort/i)
        expect(looked).toBe(false)
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
