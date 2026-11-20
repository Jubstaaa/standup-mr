import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { packageVersion } from '../manifest/manifest'
import { readStandupSkillBody } from '../skill/skill'

import {
    INSTRUCTIONS_TOOL_ANNOTATIONS,
    INSTRUCTIONS_TOOL_DESCRIPTION,
    INSTRUCTIONS_TOOL_TITLE,
    POST_TOOL_ANNOTATIONS,
    POST_TOOL_TITLE,
    SERVER_ICONS,
    STANDUP_PROMPT_DESCRIPTION,
    STANDUP_PROMPT_TITLE,
    STANDUP_TOOL_ANNOTATIONS,
    STANDUP_TOOL_TITLE,
} from './mcp-tools.constants'

// A type alias, not an interface: only an alias is assignable to the SDK's
// CallToolResult, which carries an index signature.
export type ToolResult = {
    content: Array<{ type: 'text'; text: string }>
    isError?: true
}

export function text(body: string): ToolResult {
    return { content: [{ type: 'text' as const, text: body }] }
}

export function failure(body: string): ToolResult {
    return { content: [{ type: 'text' as const, text: body }], isError: true }
}

// The URL parser must hand a bare host[:port] back unchanged, so no scheme,
// path, credentials, query or fragment can ride along into the API URL.
function isBareHost(value: string): boolean {
    try {
        return new URL(`https://${value}`).host === value.toLowerCase()
    } catch {
        return false
    }
}

export const HOST_SCHEMA = z.string().max(253).refine(isBareHost, {
    message:
        'Pass a bare host such as gitlab.example.com, without a scheme or path.',
})

export const LANG_ARG_SCHEMA = z
    .enum(['en', 'tr'])
    .optional()
    .describe(
        'Language for the date labels inside the returned JSON: en (default) or tr. ' +
            'It relabels dates and nothing else — no field is translated, and the ' +
            'standup note itself is written by the caller, in whatever language they ' +
            'are speaking.'
    )

export const POST_TEXT_ARG_SCHEMA = z
    .string()
    .min(1)
    .describe(
        'The note to post, as the chat should render it. Slack and Discord both take ' +
            'Markdown, so send the written note rather than the raw JSON from ' +
            'get_standup_data.'
    )

export async function runInstructionsTool(): Promise<ToolResult> {
    return text(readStandupSkillBody())
}

const STANDUP_PROMPT_SCHEMA = {
    account: z
        .string()
        .optional()
        .describe(
            'Which account to read when several are linked: github, gitlab, or a host.'
        ),
}

function standupPrompt(args: { account?: string }) {
    const account = args.account?.trim()
    const which = account
        ? ` Read the ${account} account (pass it as provider or host).`
        : ''
    return {
        messages: [
            {
                role: 'user' as const,
                content: {
                    type: 'text' as const,
                    text:
                        'Write my standup note. First call get_note_instructions and ' +
                        'follow its rules, then call get_standup_data.' +
                        which +
                        ' If several accounts are linked and I did not say which, ask me. ' +
                        "Write the note in the language I'm using. Do not post it anywhere " +
                        'unless I ask.',
                },
            },
        ],
    }
}

interface ToolDefinition<Shape extends z.ZodRawShape> {
    description: string
    inputSchema: Shape
    run: ToolCallback<Shape>
}

// The local stdio server and the remote connector differ only in how they
// collect and where they post; names, titles, hints, the rules tool and the
// prompt stay identical so a client sees one product.
export interface StandupServerTools<
    StandupShape extends z.ZodRawShape = z.ZodRawShape,
    PostShape extends z.ZodRawShape = z.ZodRawShape,
> {
    post: ToolDefinition<PostShape>
    standup: ToolDefinition<StandupShape>
}

export function createStandupServer<
    StandupShape extends z.ZodRawShape,
    PostShape extends z.ZodRawShape,
>(tools: StandupServerTools<StandupShape, PostShape>): McpServer {
    const server = new McpServer({
        name: 'standup-mr',
        version: packageVersion(import.meta.url),
        icons: SERVER_ICONS,
    })

    server.registerTool(
        'get_standup_data',
        {
            title: STANDUP_TOOL_TITLE,
            description: tools.standup.description,
            inputSchema: tools.standup.inputSchema,
            annotations: STANDUP_TOOL_ANNOTATIONS,
        },
        tools.standup.run
    )

    server.registerTool(
        'post_standup_note',
        {
            title: POST_TOOL_TITLE,
            description: tools.post.description,
            inputSchema: tools.post.inputSchema,
            annotations: POST_TOOL_ANNOTATIONS,
        },
        tools.post.run
    )

    server.registerTool(
        'get_note_instructions',
        {
            title: INSTRUCTIONS_TOOL_TITLE,
            description: INSTRUCTIONS_TOOL_DESCRIPTION,
            annotations: INSTRUCTIONS_TOOL_ANNOTATIONS,
        },
        async () => await runInstructionsTool()
    )

    server.registerPrompt(
        'standup',
        {
            title: STANDUP_PROMPT_TITLE,
            description: STANDUP_PROMPT_DESCRIPTION,
            argsSchema: STANDUP_PROMPT_SCHEMA,
        },
        args => standupPrompt(args)
    )

    return server
}
