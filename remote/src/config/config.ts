import { z } from 'zod'

import type { GitLabInstance, RemoteConfig } from './config.types'

const optional = z
    .string()
    .optional()
    .transform(value => value || undefined)

const INSTANCE_FORMAT = /^([a-z0-9.-]+):([^:\s]+):([^:\s]+)$/i

// "git.example.com:<client id>:<secret>", comma separated: one OAuth
// application registered on each self-hosted GitLab.
function parseInstances(
    value: string,
    context: z.RefinementCtx
): GitLabInstance[] {
    const instances: GitLabInstance[] = []
    for (const entry of value.split(',').map(item => item.trim())) {
        if (!entry) continue
        const match = entry.match(INSTANCE_FORMAT)
        if (!match) {
            context.addIssue({
                code: 'custom',
                message: `"${entry.split(':')[0]}" must be host:client_id:secret`,
            })
            continue
        }
        instances.push({
            host: match[1]!.toLowerCase(),
            clientId: match[2]!,
            clientSecret: match[3]!,
        })
    }
    return instances
}

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
    GITLAB_INSTANCES: z
        .string()
        .default('')
        .transform((value, context) => parseInstances(value, context)),
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
        gitlabInstances: values.GITLAB_INSTANCES,
        blockedAddresses: values.BLOCKED_ADDRESSES.split(',')
            .map(address => address.trim())
            .filter(Boolean),
    }
}
