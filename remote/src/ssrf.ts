import { lookup as dnsLookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'

type Lookup = (
    host: string
) => Promise<Array<{ address: string; family: number }>>

const defaultLookup: Lookup = host => dnsLookup(host, { all: true })

function privateRanges(extra: string[]): BlockList {
    const list = new BlockList()
    for (const [network, prefix] of [
        ['0.0.0.0', 8],
        ['10.0.0.0', 8],
        ['100.64.0.0', 10],
        ['127.0.0.0', 8],
        ['169.254.0.0', 16],
        ['172.16.0.0', 12],
        ['192.168.0.0', 16],
        ['224.0.0.0', 4],
    ] as const) {
        list.addSubnet(network, prefix, 'ipv4')
    }
    for (const [network, prefix] of [
        ['::', 128],
        ['::1', 128],
        ['fc00::', 7],
        ['fe80::', 10],
        ['ff00::', 8],
    ] as const) {
        list.addSubnet(network, prefix, 'ipv6')
    }
    for (const address of extra) {
        list.addAddress(address, isIP(address) === 6 ? 'ipv6' : 'ipv4')
    }
    return list
}

export class HostError extends Error {}

// Accepts what people paste — "https://git.example.com/", "git.example.com" —
// and returns the bare host the providers expect.
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
    return url.host
}

export function createHostGuard(
    blockedAddresses: string[] = [],
    lookup: Lookup = defaultLookup
) {
    const blocked = privateRanges(blockedAddresses)

    function isBlocked(address: string): boolean {
        const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)
        if (mapped) return blocked.check(mapped[1]!, 'ipv4')
        return blocked.check(address, isIP(address) === 6 ? 'ipv6' : 'ipv4')
    }

    // Self-hosted hosts are user input, and the server fetches them. Without
    // this check anyone could point it at the droplet's own network.
    return async function assertPublicHost(host: string): Promise<void> {
        const hostname = new URL(`https://${host}`).hostname.replace(
            /^\[|\]$/g,
            ''
        )
        const addresses = isIP(hostname)
            ? [{ address: hostname, family: isIP(hostname) }]
            : await lookup(hostname).catch(() => {
                  throw new HostError(`Could not resolve ${hostname}.`)
              })
        if (
            addresses.length === 0 ||
            addresses.some(a => isBlocked(a.address))
        ) {
            throw new HostError(
                `${hostname} points to a private or reserved address.`
            )
        }
    }
}

export type HostGuard = ReturnType<typeof createHostGuard>
