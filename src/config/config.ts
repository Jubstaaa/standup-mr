import { execFileSync } from 'node:child_process'

import { CLI_TIMEOUT_MS } from './config.constants'

export class ConfigError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'ConfigError'
    }
}

export interface ProviderLabels {
    cli: string
    envHost: string
    envToken: string
    login: (host: string) => string
    name: string
}

export const GITLAB_LABELS: ProviderLabels = {
    name: 'GitLab',
    cli: 'glab',
    envHost: 'GITLAB_HOST',
    envToken: 'GITLAB_TOKEN',
    login: host => `glab auth login --hostname ${host}`,
}

export const GITHUB_LABELS: ProviderLabels = {
    name: 'GitHub',
    cli: 'gh',
    envHost: 'GITHUB_HOST',
    envToken: 'GITHUB_TOKEN',
    login: host => `gh auth login --hostname ${host}`,
}

export function resolveHost(
    cliHost?: string,
    envHost?: string,
    hostList?: string[],
    labels: ProviderLabels = GITLAB_LABELS
): string {
    if (cliHost) return cliHost
    if (envHost) return envHost

    const hosts = hostList ?? []
    if (hosts.length === 1) return hosts[0]!
    if (hosts.length === 0) {
        throw new ConfigError(
            `No ${labels.name} host configured. Pass --host, set ${labels.envHost}, ` +
                `or log in with \`${labels.cli} auth login\`.`
        )
    }
    throw new ConfigError(
        `Multiple ${labels.name} hosts found (${[...hosts].sort().join(', ')}). ` +
            `Pick one with --host or ${labels.envHost}.`
    )
}

export function resolveToken(
    host: string,
    cliToken?: string,
    envToken?: string,
    lookup?: (host: string) => string,
    labels: ProviderLabels = GITLAB_LABELS
): string {
    if (cliToken) return cliToken
    if (envToken) return envToken
    if (lookup) {
        const token = lookup(host)
        if (token) return token
    }
    throw new ConfigError(
        `No token for ${host}. Pass --token, set ${labels.envToken}, ` +
            `or run \`${labels.login(host)}\`.`
    )
}

function cliCapture(cli: string, args: string[]): string {
    try {
        return execFileSync(cli, args, {
            encoding: 'utf8',
            timeout: CLI_TIMEOUT_MS,
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim()
    } catch {
        return ''
    }
}

function cliStatus(cli: string): string {
    try {
        return execFileSync(cli, ['auth', 'status'], {
            encoding: 'utf8',
            timeout: CLI_TIMEOUT_MS,
            stdio: ['ignore', 'pipe', 'pipe'],
        })
    } catch (error) {
        const result = error as { stdout?: string; stderr?: string }
        return `${result.stdout ?? ''}${result.stderr ?? ''}`
    }
}

export function parseLoggedInHosts(statusOutput: string): string[] {
    const hosts = [...statusOutput.matchAll(/Logged in to (\S+)/g)].map(
        match => match[1]!
    )
    return [...new Set(hosts)].sort()
}

export const parseGlabHosts = parseLoggedInHosts

export function glabHosts(): string[] {
    return parseLoggedInHosts(cliStatus('glab'))
}

export function glabToken(host: string): string {
    return cliCapture('glab', ['config', 'get', 'token', '--host', host])
}

export function ghHosts(): string[] {
    return parseLoggedInHosts(cliStatus('gh'))
}

export function ghToken(host: string): string {
    return cliCapture('gh', ['auth', 'token', '--hostname', host])
}
