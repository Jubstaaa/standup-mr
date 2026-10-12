import type { RemoteConfig } from './remote.types'

function required(env: Record<string, string | undefined>, name: string) {
    const value = env[name]
    if (!value) throw new Error(`${name} is required`)
    return value
}

function optionalApp(
    env: Record<string, string | undefined>,
    idName: string,
    secretName: string
) {
    const clientId = env[idName]
    const clientSecret = env[secretName]
    if (!clientId || !clientSecret) return undefined
    return { clientId, clientSecret }
}

export function loadConfig(
    env: Record<string, string | undefined> = process.env
): RemoteConfig {
    const encryptionKey = Buffer.from(required(env, 'ENCRYPTION_KEY'), 'base64')
    if (encryptionKey.length !== 32) {
        throw new Error(
            'ENCRYPTION_KEY must be 32 bytes, base64 encoded (openssl rand -base64 32)'
        )
    }

    return {
        baseUrl: new URL(required(env, 'PUBLIC_URL')),
        port: Number(env.PORT ?? 3000),
        databasePath: env.DATABASE_PATH ?? '/data/standup.db',
        encryptionKey,
        github: optionalApp(env, 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET'),
        githubAppSlug: env.GITHUB_APP_SLUG,
        gitlab: optionalApp(env, 'GITLAB_CLIENT_ID', 'GITLAB_CLIENT_SECRET'),
        blockedAddresses: (env.BLOCKED_ADDRESSES ?? '')
            .split(',')
            .map(address => address.trim())
            .filter(Boolean),
    }
}
