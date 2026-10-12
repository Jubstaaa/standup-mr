import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import {
    collect,
    failure,
    INSTRUCTIONS_TOOL_ANNOTATIONS,
    INSTRUCTIONS_TOOL_DESCRIPTION,
    POST_TOOL_ANNOTATIONS,
    POST_TOOL_SCHEMA,
    runInstructionsTool,
    STANDUP_TOOL_ANNOTATIONS,
    STANDUP_TOOL_SCHEMA,
    text,
} from '../../mcp/server'
import type { ToolResult } from '../../mcp/server'
import { packageVersion } from '../../src/manifest/manifest'
import { postWebhook } from '../../src/notify/notify'
import type { FetchLike, ProviderKind } from '../../src/types/standup.types'

import { pickAccount, providerFor } from './accounts'
import type { TokenRefresher } from './accounts'
import { errorMessage } from './errors'
import type { Store } from './store'
import {
    NO_WEBHOOK_MESSAGE,
    REMOTE_HOST_ARG_DESCRIPTION,
    REMOTE_POST_TOOL_DESCRIPTION,
    REMOTE_PROVIDER_ARG_DESCRIPTION,
    REMOTE_STANDUP_TOOL_DESCRIPTION,
} from './tools.constants'

export interface ToolContext {
    connectionId: string
    fetchImpl: FetchLike
    freshAccessToken: TokenRefresher
    now: () => number
    store: Store
}

const REMOTE_STANDUP_SCHEMA = {
    provider: z
        .enum(['github', 'gitlab'])
        .optional()
        .describe(REMOTE_PROVIDER_ARG_DESCRIPTION),
    host: z.string().optional().describe(REMOTE_HOST_ARG_DESCRIPTION),
    lang: STANDUP_TOOL_SCHEMA.lang,
}

export async function runRemoteStandup(
    args: { host?: string; lang?: string; provider?: ProviderKind },
    context: ToolContext
): Promise<ToolResult> {
    try {
        const now = context.now()
        context.store.touchConnection(context.connectionId, now)
        const account = pickAccount(
            context.store.listAccounts(context.connectionId),
            args
        )
        const token = await context.freshAccessToken(account, now)
        const report = await collect({
            providerImpl: providerFor(
                account.provider,
                account.host,
                token,
                context.fetchImpl
            ),
            lang: args.lang,
        })
        return text(JSON.stringify(report))
    } catch (error) {
        return failure(errorMessage(error))
    }
}

export async function runRemotePost(
    args: { text: string },
    context: ToolContext
): Promise<ToolResult> {
    const webhook = context.store.getWebhook(context.connectionId)
    if (!webhook) return failure(NO_WEBHOOK_MESSAGE)
    try {
        await postWebhook(
            webhook.url,
            args.text,
            webhook.kind,
            context.fetchImpl
        )
    } catch (error) {
        return failure(
            `The ${webhook.kind} webhook did not accept the note: ${errorMessage(error)}`
        )
    }
    return text(`Posted the note to the saved ${webhook.kind} webhook.`)
}

export function createRemoteServer(context: ToolContext): McpServer {
    const server = new McpServer({
        name: 'standup-mr',
        // remote/ has its own package.json without a version; the published
        // package's version is the one the tools belong to.
        version: packageVersion(
            new URL('../../mcp/server.ts', import.meta.url).href
        ),
    })

    server.registerTool(
        'get_standup_data',
        {
            description: REMOTE_STANDUP_TOOL_DESCRIPTION,
            inputSchema: REMOTE_STANDUP_SCHEMA,
            annotations: STANDUP_TOOL_ANNOTATIONS,
        },
        async args => await runRemoteStandup(args, context)
    )

    server.registerTool(
        'post_standup_note',
        {
            description: REMOTE_POST_TOOL_DESCRIPTION,
            inputSchema: { text: POST_TOOL_SCHEMA.text },
            annotations: POST_TOOL_ANNOTATIONS,
        },
        async args => await runRemotePost(args, context)
    )

    server.registerTool(
        'get_note_instructions',
        {
            description: INSTRUCTIONS_TOOL_DESCRIPTION,
            annotations: INSTRUCTIONS_TOOL_ANNOTATIONS,
        },
        async () => await runInstructionsTool()
    )

    return server
}
