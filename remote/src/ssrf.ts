import { lookup as dnsLookup } from 'node:dns'
import type { LookupAddress, LookupOptions } from 'node:dns'

import axios from 'axios'
import type { AxiosRequestConfig } from 'axios'
import ipaddr from 'ipaddr.js'

import type { FetchLike } from '../../src/types/standup.types'

import {
    MAX_REDIRECTS,
    NULL_BODY_STATUSES,
    REQUEST_TIMEOUT_MS,
} from './ssrf.constants'

type LookupCallback = (
    error: NodeJS.ErrnoException | null,
    address: string | LookupAddress[],
    family?: number
) => void

export type Lookup = (
    hostname: string,
    options: LookupOptions,
    callback: LookupCallback
) => void

export class HostError extends Error {}

export function normalizeHost(input: string): string {
    const trimmed = input.trim().toLowerCase()
    const withScheme = /^[a-z]+:\/\//.test(trimmed)
        ? trimmed
        : `https://${trimmed}`
    let url: URL
    try {
        url = new URL(withScheme)
    } catch {
        throw new HostError(`"${input}" is not a valid host.`)
    }
    if (url.protocol !== 'https:') {
        throw new HostError('Only https hosts are supported.')
    }
    if (url.username || url.password) {
        throw new HostError('The host must not contain credentials.')
    }
    // A custom port would turn the token check into a port scanner.
    if (url.port) {
        throw new HostError('Only the default https port (443) is supported.')
    }
    return url.hostname
}

// Only plain public unicast passes: ipaddr.js names every special range
// (private, loopback, link-local, CGNAT, NAT64, 6to4, Teredo, reserved…), so
// anything that is not 'unicast' is refused rather than listed one by one.
export function isPublicAddress(
    address: string,
    blocked: ReadonlySet<string> = new Set()
): boolean {
    if (!ipaddr.isValid(address)) return false
    const parsed = ipaddr.process(address)
    // IPv4-compatible ::a.b.c.d is deprecated but still reported as unicast.
    const isIpv4Compatible =
        parsed.kind() === 'ipv6' && parsed.match(ipaddr.parse('::'), 96)
    return (
        parsed.range() === 'unicast' &&
        !isIpv4Compatible &&
        !blocked.has(parsed.toString())
    )
}

export function blockedSet(addresses: string[]): ReadonlySet<string> {
    return new Set(
        addresses
            .filter(address => ipaddr.isValid(address))
            .map(address => ipaddr.process(address).toString())
    )
}

// The guarded lookup never runs for an IP-literal host — the socket dials
// it directly — so URLs, including every redirect target, are checked too.
function assertPublicTarget(
    target: { hostname: string; port: string; protocol: string },
    blocked: ReadonlySet<string>
): void {
    if (target.protocol !== 'https:') {
        throw new HostError('Only https URLs are fetched.')
    }
    if (target.port && target.port !== '443') {
        throw new HostError('Only the default https port (443) is fetched.')
    }
    const hostname = target.hostname.replace(/^\[|\]$/g, '')
    if (ipaddr.isValid(hostname) && !isPublicAddress(hostname, blocked)) {
        throw new HostError(`${hostname} is a private or reserved address.`)
    }
}

// Runs inside the socket connect, on the addresses actually dialled, so a
// DNS answer that changes between a check and the request cannot slip past.
export function createGuardedLookup(
    blocked: ReadonlySet<string> = new Set(),
    lookup: Lookup = dnsLookup as Lookup
): Lookup {
    return (hostname, options, callback) => {
        lookup(hostname, { ...options, all: true }, (error, result) => {
            if (error) return callback(error, [])
            const addresses = result as LookupAddress[]
            if (
                addresses.length === 0 ||
                addresses.some(
                    entry => !isPublicAddress(entry.address, blocked)
                )
            ) {
                return callback(
                    new HostError(
                        `${hostname} points to a private or reserved address.`
                    ),
                    []
                )
            }
            if (options.all) return callback(null, addresses)
            callback(null, addresses[0]!.address, addresses[0]!.family)
        })
    }
}

export function createHostCheck(lookup: Lookup) {
    return (host: string) =>
        new Promise<void>((resolve, reject) => {
            lookup(host, {}, error => {
                if (!error) return resolve()
                reject(
                    error instanceof HostError
                        ? error
                        : new HostError(`Could not resolve ${host}.`)
                )
            })
        })
}

export type HostCheck = ReturnType<typeof createHostCheck>

function plainHeaders(init?: RequestInit): Record<string, string> {
    return Object.fromEntries(new Headers(init?.headers).entries())
}

// The providers speak fetch; this answers in fetch's shape while every
// connection — redirects included — goes through the guarded lookup.
// Authorization is dropped by follow-redirects when a redirect changes host.
export function createGuardedFetch(
    lookup: Lookup,
    blocked: ReadonlySet<string> = new Set()
): FetchLike {
    return async (url, init) => {
        assertPublicTarget(new URL(url), blocked)
        const response = await axios.request<ArrayBuffer>({
            url,
            method: init?.method ?? 'GET',
            headers: plainHeaders(init),
            data: init?.body,
            adapter: 'http',
            lookup: lookup as AxiosRequestConfig['lookup'],
            responseType: 'arraybuffer',
            timeout: REQUEST_TIMEOUT_MS,
            maxRedirects: init?.redirect === 'manual' ? 0 : MAX_REDIRECTS,
            beforeRedirect: options => {
                assertPublicTarget(
                    {
                        hostname: String(options.hostname ?? ''),
                        port: String(options.port ?? ''),
                        protocol: String(options.protocol ?? ''),
                    },
                    blocked
                )
            },
            validateStatus: () => true,
        })
        const headers = new Headers()
        for (const [name, value] of Object.entries(response.headers)) {
            if (value === undefined || value === null) continue
            for (const item of [value].flat())
                headers.append(name, String(item))
        }
        const hasBody = !NULL_BODY_STATUSES.has(response.status)
        return new Response(hasBody ? response.data : null, {
            status: response.status,
            headers,
        })
    }
}
