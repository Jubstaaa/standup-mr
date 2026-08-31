import {
    ConfigError,
    GITHUB_LABELS,
    GITLAB_LABELS,
    ghHosts,
    ghToken,
    glabHosts,
    glabToken,
    resolveHost,
    resolveToken,
} from '../config/config'
import { GitHubProvider } from './github/github'
import { DOT_COM } from './github/github.constants'
import { GitLabProvider } from './gitlab/gitlab'
import type { ProviderLabels } from '../config/config'
import type { Provider, ProviderKind } from './base/base.types'

export interface SelectOptions {
    provider?: string
    host?: string
    token?: string
    env?: Record<string, string | undefined>
    probe?: { gitlab: () => string[]; github: () => string[] }
}

const DEFAULT_PROBE = { gitlab: glabHosts, github: ghHosts }

function hostFrom(
    cliHost: string | undefined,
    envHost: string | undefined,
    probe: () => string[],
    fallback: string[],
    labels: ProviderLabels
): string {
    if (cliHost) return cliHost
    if (envHost) return envHost
    const found = probe()
    return resolveHost(undefined, undefined, found.length > 0 ? found : fallback, labels)
}

export function chooseKind(options: SelectOptions = {}): ProviderKind {
    const env = options.env ?? process.env
    const probe = options.probe ?? DEFAULT_PROBE

    if (options.provider) {
        if (options.provider === 'github' || options.provider === 'gitlab') {
            return options.provider
        }
        throw new ConfigError(
            `Unknown provider "${options.provider}" for --provider. Use github or gitlab.`
        )
    }

    if (options.host) {
        const host = options.host.toLowerCase()
        if (host === DOT_COM || host.includes('github')) return 'github'
        if (host === 'gitlab.com' || host.includes('gitlab')) return 'gitlab'
    }

    if (env.STANDUP_PROVIDER) {
        if (env.STANDUP_PROVIDER === 'github' || env.STANDUP_PROVIDER === 'gitlab') {
            return env.STANDUP_PROVIDER
        }
        throw new ConfigError(
            `Unknown provider "${env.STANDUP_PROVIDER}" for STANDUP_PROVIDER. Use github or gitlab.`
        )
    }

    const hasGitHubEnv = Boolean(env.GITHUB_HOST || env.GITHUB_TOKEN)
    const hasGitLabEnv = Boolean(env.GITLAB_HOST || env.GITLAB_TOKEN)
    if (hasGitHubEnv !== hasGitLabEnv) return hasGitHubEnv ? 'github' : 'gitlab'
    if (hasGitHubEnv && hasGitLabEnv) {
        throw new ConfigError(
            'Both GITHUB_* and GITLAB_* are configured. ' +
                'Pass --provider github or --provider gitlab.'
        )
    }

    const ghLoggedIn = probe.github().length > 0
    const glabLoggedIn = probe.gitlab().length > 0
    if (ghLoggedIn !== glabLoggedIn) return ghLoggedIn ? 'github' : 'gitlab'
    if (ghLoggedIn && glabLoggedIn) {
        throw new ConfigError(
            'Both gh and glab are authenticated. ' +
                'Pass --provider github or --provider gitlab.'
        )
    }

    throw new ConfigError(
        'No provider configured. Pass --provider with --host and --token, set ' +
            'GITHUB_* or GITLAB_* environment variables, or log in with gh or glab.'
    )
}

export function connect(options: SelectOptions = {}): Provider {
    const env = options.env ?? process.env
    const probe = options.probe ?? DEFAULT_PROBE

    if (chooseKind(options) === 'github') {
        const host = hostFrom(options.host, env.GITHUB_HOST, probe.github, [DOT_COM], GITHUB_LABELS)
        const token = resolveToken(
            host,
            options.token,
            env.GITHUB_TOKEN,
            ghToken,
            GITHUB_LABELS
        )
        return new GitHubProvider(host, token)
    }

    const host = hostFrom(options.host, env.GITLAB_HOST, probe.gitlab, [], GITLAB_LABELS)
    const token = resolveToken(
        host,
        options.token,
        env.GITLAB_TOKEN,
        glabToken,
        GITLAB_LABELS
    )
    return new GitLabProvider(host, token)
}
