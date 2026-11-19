import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

import { packageVersion } from '../src/manifest/manifest'

import {
    INSTRUCTIONS_TOOL_ANNOTATIONS,
    INSTRUCTIONS_TOOL_DESCRIPTION,
    INSTRUCTIONS_TOOL_TITLE,
    POST_TOOL_ANNOTATIONS,
    POST_TOOL_DESCRIPTION,
    POST_TOOL_SCHEMA,
    POST_TOOL_TITLE,
    runInstructionsTool,
    runPostTool,
    runStandupTool,
    SERVER_ICONS,
    STANDUP_PROMPT_DESCRIPTION,
    STANDUP_PROMPT_SCHEMA,
    STANDUP_PROMPT_TITLE,
    STANDUP_TOOL_ANNOTATIONS,
    STANDUP_TOOL_DESCRIPTION,
    STANDUP_TOOL_SCHEMA,
    STANDUP_TOOL_TITLE,
    standupPrompt,
} from './tools'

export function createServer(): McpServer {
    const server = new McpServer({
        name: 'standup-mr',
        version: packageVersion(import.meta.url),
        icons: SERVER_ICONS,
    })

    server.registerTool(
        'get_standup_data',
        {
            title: STANDUP_TOOL_TITLE,
            description: STANDUP_TOOL_DESCRIPTION,
            inputSchema: STANDUP_TOOL_SCHEMA,
            annotations: STANDUP_TOOL_ANNOTATIONS,
        },
        async args => await runStandupTool(args)
    )

    server.registerTool(
        'post_standup_note',
        {
            title: POST_TOOL_TITLE,
            description: POST_TOOL_DESCRIPTION,
            inputSchema: POST_TOOL_SCHEMA,
            annotations: POST_TOOL_ANNOTATIONS,
        },
        async args => await runPostTool(args)
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

export async function main(): Promise<void> {
    await createServer().connect(new StdioServerTransport())
}

const entry = process.argv[1]
let entryUrl: string | undefined
try {
    entryUrl = entry ? pathToFileURL(realpathSync(entry)).href : undefined
} catch {
    entryUrl = undefined
}
if (entryUrl && import.meta.url === entryUrl) {
    main().catch((error: unknown) => {
        process.stderr.write(
            `${error instanceof Error ? error.message : String(error)}\n`
        )
        process.exitCode = 1
    })
}
