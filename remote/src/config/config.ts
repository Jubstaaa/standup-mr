import { z } from 'zod'

import type { RemoteConfig } from './config.types'

const optional = z
    .string()
    .optional()
    .transform(value => value || undefined)

const envSchema = z.object({
    PUBLIC_URL: z.url(),
    PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_PATH: z.string().default('/data/standup.db'),
    ENCRYPTION_KEY: z
        .base64()
        .refine(value => Buffer.from(value, 'base64').length === 32, {
            message:
                'must be 32 bytes, base64 encoded (openssl rand -base64 32)',
        }),
    GITHUB_CLIENT_ID: optional,
    GITHUB_CLIENT_SECRET: optional,
    GITHUB_APP_SLUG: optional,
    GITLAB_CLIENT_ID: optional,
    GITLAB_CLIENT_SECRET: optional,
    BLOCKED_ADDRESSES: z.string().default(''),
})

function credentials(clientId?: string, clientSecret?: string) {
    return clientId && clientSecret ? { clientId, clientSecret } : undefined
}

export function loadConfig(
    env: Record<string, string | undefined> = process.env
): RemoteConfig {
    const parsed = envSchema.safeParse(env)
    if (!parsed.success) {
        throw new Error(
            `Invalid environment:\n${z.prettifyError(parsed.error)}`
        )
    }
    const values = parsed.data
    return {
        baseUrl: new URL(values.PUBLIC_URL),
        port: values.PORT,
        databasePath: values.DATABASE_PATH,
        encryptionKey: Buffer.from(values.ENCRYPTION_KEY, 'base64'),
        github: credentials(
            values.GITHUB_CLIENT_ID,
            values.GITHUB_CLIENT_SECRET
        ),
        githubAppSlug: values.GITHUB_APP_SLUG,
        gitlab: credentials(
            values.GITLAB_CLIENT_ID,
            values.GITLAB_CLIENT_SECRET
        ),
        blockedAddresses: values.BLOCKED_ADDRESSES.split(',')
            .map(address => address.trim())
            .filter(Boolean),
    }
}
