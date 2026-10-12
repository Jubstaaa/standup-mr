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
    return parsed.range() === 'unicast' && !blocked.has(parsed.toString())
}

// Runs inside the socket connect, on the addresses actually dialled, so a
// DNS answer that changes between a check and the request cannot slip past.
export function createGuardedLookup(
    blockedAddresses: string[] = [],
    lookup: Lookup = dnsLookup as Lookup
): Lookup {
    const blocked = new Set(
        blockedAddresses
            .filter(address => ipaddr.isValid(address))
            .map(address => ipaddr.process(address).toString())
    )
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
export function createGuardedFetch(lookup: Lookup): FetchLike {
    return async (url, init) => {
        if (!url.startsWith('https://')) {
            throw new HostError('Only https URLs are fetched.')
        }
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
                if (options.protocol !== 'https:') {
                    throw new HostError('Refusing a redirect away from https.')
                }
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
