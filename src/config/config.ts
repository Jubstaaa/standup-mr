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
    labels: ProviderLabels = GITLAB_LABELS,
    envHost?: string
): string {
    if (cliToken) return cliToken
    // The env token belongs to envHost only. A host from a tool call that
    // does not match must never receive it, or a prompt-injected host could
    // walk off with the user's token.
    if (envToken && (envHost === undefined || host === envHost)) return envToken
    if (lookup) {
        const token = lookup(host)
        if (token) return token
    }
    throw new ConfigError(
        `No token for ${host}. Pass --token, set ${labels.envToken}, ` +
            `or run \`${labels.login(host)}\`.`
    )
}

interface ExecFailure {
    code?: string
    signal?: NodeJS.Signals | null
    status?: number | null
}

// A missing cli or a non-zero exit (not logged in, unknown host) means "no
// token here"; a timeout or a crash is a broken cli the user has to see.
function meansNoToken(error: unknown): boolean {
    const failure = error as ExecFailure
    if (failure.code === 'ENOENT') return true
    return typeof failure.status === 'number' && failure.status !== 0
}

function cliCapture(cli: string, args: string[]): string {
    try {
        return execFileSync(cli, args, {
            encoding: 'utf8',
            timeout: CLI_TIMEOUT_MS,
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim()
    } catch (error) {
        if (meansNoToken(error)) return ''
        const { code, signal } = error as ExecFailure
        const reason =
            code === 'ETIMEDOUT'
                ? `timed out after ${CLI_TIMEOUT_MS / 1000}s`
                : `was stopped by ${signal ?? code ?? 'an unknown error'}`
        throw new ConfigError(
            `\`${cli} ${args.join(' ')}\` ${reason}. Run it yourself to see ` +
                'what is wrong, or pass the token directly.'
        )
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
