import { execFileSync } from 'node:child_process'

import { GLAB_TIMEOUT_MS } from './config.constants'

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

export function parseGlabHosts(statusOutput: string): string[] {
    const hosts = [...statusOutput.matchAll(/Logged in to (\S+)/g)].map((match) => match[1]!)
    return [...new Set(hosts)].sort()
}

function glabStatus(): string {
    try {
        return execFileSync('glab', ['auth', 'status'], {
            encoding: 'utf8',
            timeout: GLAB_TIMEOUT_MS,
            stdio: ['ignore', 'pipe', 'pipe'],
        })
    } catch (error) {
        const result = error as { stdout?: string; stderr?: string }
        return `${result.stdout ?? ''}${result.stderr ?? ''}`
    }
}

export function glabHosts(): string[] {
    return parseGlabHosts(glabStatus())
}

export function glabToken(host: string): string {
    return glab(['config', 'get', 'token', '--host', host])
}
