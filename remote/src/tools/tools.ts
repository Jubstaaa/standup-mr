import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import {
    createStandupServer,
    failure,
    HOST_SCHEMA,
    LANG_ARG_SCHEMA,
    POST_TEXT_ARG_SCHEMA,
    text,
} from '../../../src/mcp-tools/mcp-tools'
import type { ToolResult } from '../../../src/mcp-tools/mcp-tools'
import { postWebhook } from '../../../src/notify/notify'
import { collect } from '../../../src/report/report'
import type { FetchLike, ProviderKind } from '../../../src/standup.types'
import { pickAccount, providerFor } from '../accounts/accounts'
import type { TokenRefresher } from '../accounts/accounts'
import { errorMessage } from '../errors/errors'
import type { Store } from '../store/store'

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
    host: HOST_SCHEMA.optional().describe(REMOTE_HOST_ARG_DESCRIPTION),
    lang: LANG_ARG_SCHEMA,
}

export async function runRemoteStandup(
    args: { host?: string; lang?: string; provider?: ProviderKind },
    context: ToolContext
): Promise<ToolResult> {
    try {
        const now = context.now()
        context.store.connections.touch(context.connectionId, now)
        const account = pickAccount(
            context.store.accounts.list(context.connectionId),
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
    const webhook = context.store.connections.getWebhook(context.connectionId)
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
    return createStandupServer({
        standup: {
            description: REMOTE_STANDUP_TOOL_DESCRIPTION,
            inputSchema: REMOTE_STANDUP_SCHEMA,
            run: async args => await runRemoteStandup(args, context),
        },
        post: {
            description: REMOTE_POST_TOOL_DESCRIPTION,
            inputSchema: { text: POST_TEXT_ARG_SCHEMA },
            run: async args => await runRemotePost(args, context),
        },
    })
}
