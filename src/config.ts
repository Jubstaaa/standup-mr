/**
 * Resolve which GitLab instance to talk to, and with what credentials.
 *
 * Host and token resolve independently through the same precedence: explicit
 * argument, then environment, then the local `glab` CLI config. The glab step
 * is best-effort on purpose — MCP servers routinely run in containers where
 * glab is not installed.
 */

import { execFileSync } from 'node:child_process'

const GLAB_TIMEOUT_MS = 15_000

export class ConfigError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'ConfigError'
    }
}

export function resolveHost(
    cliHost?: string,
    envHost?: string,
    glabHostList?: string[]
): string {
    if (cliHost) return cliHost
    if (envHost) return envHost

    const hosts = glabHostList ?? []
    if (hosts.length === 1) return hosts[0]!
    if (hosts.length === 0) {
        throw new ConfigError(
            'No GitLab host configured. Pass --host, set GITLAB_HOST, ' +
                'or log in with `glab auth login`.'
        )
    }
    throw new ConfigError(
        `Multiple GitLab hosts found (${[...hosts].sort().join(', ')}). ` +
            'Pick one with --host or GITLAB_HOST.'
    )
}

export function resolveToken(
    host: string,
    cliToken?: string,
    envToken?: string,
    glabLookup?: (host: string) => string
): string {
    if (cliToken) return cliToken
    if (envToken) return envToken
    if (glabLookup) {
        const token = glabLookup(host)
        if (token) return token
    }
    throw new ConfigError(
        `No token for ${host}. Pass --token, set GITLAB_TOKEN, ` +
            `or run \`glab auth login --hostname ${host}\`.`
    )
}

function glab(args: string[]): string {
    try {
        return execFileSync('glab', args, {
            encoding: 'utf8',
            timeout: GLAB_TIMEOUT_MS,
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim()
    } catch {
        return ''
    }
}

/** Hosts glab is authenticated against. Empty list if glab is absent. */
export function glabHosts(): string[] {
    const raw = glab(['auth', 'status', '--json'])
    if (raw) {
        try {
            const parsed: unknown = JSON.parse(raw)
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return Object.keys(parsed as Record<string, unknown>).sort()
            }
        } catch {
            // Older glab builds have no --json; fall through.
        }
    }
    const single = glab(['config', 'get', 'host'])
    return single ? [single] : []
}

/** Token glab holds for `host`. Empty string if glab is absent. */
export function glabToken(host: string): string {
    return glab(['config', 'get', 'token', '--host', host])
}
