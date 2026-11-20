import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

import { createStandupServer } from '../src/mcp-tools/mcp-tools'

import {
    POST_TOOL_DESCRIPTION,
    POST_TOOL_SCHEMA,
    runPostTool,
    runStandupTool,
    STANDUP_TOOL_DESCRIPTION,
    STANDUP_TOOL_SCHEMA,
} from './tools'

export function createServer(): McpServer {
    return createStandupServer({
        standup: {
            description: STANDUP_TOOL_DESCRIPTION,
            inputSchema: STANDUP_TOOL_SCHEMA,
            run: async args => await runStandupTool(args),
        },
        post: {
            description: POST_TOOL_DESCRIPTION,
            inputSchema: POST_TOOL_SCHEMA,
            run: async args => await runPostTool(args),
        },
    })
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
