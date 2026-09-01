import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

import { connect } from '../src/providers/select'
import type { Provider } from '../src/providers/base/base.types'
import { buildReport } from '../src/report/report'
import type { StandupReport } from '../src/types/standup.types'

export interface CollectOptions {
    provider?: string
    host?: string
    token?: string
    lang?: string
    providerImpl?: Provider
}

export async function collect(options: CollectOptions = {}): Promise<StandupReport> {
    const provider =
        options.providerImpl ??
        connect({ provider: options.provider, host: options.host, token: options.token })
    return buildReport(provider, new Date(), options.lang ?? 'en')
}

export async function main(): Promise<void> {
    const server = new McpServer({ name: 'standup-mr', version: '0.3.0' })

    server.tool(
        'get_standup_data',
        'Collect merge-request-based standup data from GitLab or GitHub. Returns the ' +
            'previous working day activity, open merge requests or pull requests bucketed ' +
            'by state (ready / blocked / draft / stale), pending reviews, and the error ' +
            'lines from any failed pipeline or check.',
        {},
        async () => {
            const report = await collect()
            return { content: [{ type: 'text' as const, text: JSON.stringify(report) }] }
        }
    )

    await server.connect(new StdioServerTransport())
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
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
        process.exitCode = 1
    })
}
