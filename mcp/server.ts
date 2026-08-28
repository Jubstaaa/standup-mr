import { pathToFileURL } from 'node:url'

import { glabHosts, glabToken, resolveHost, resolveToken } from '../src/config/config'
import type { Provider } from '../src/providers/base/base.types'
import { GitLabProvider } from '../src/providers/gitlab/gitlab'
import { buildReport } from '../src/report/report'
import type { StandupReport } from '../src/types/standup.types'

export interface CollectOptions {
    host?: string
    token?: string
    lang?: string
    provider?: Provider
}

function resolveProvider(options: CollectOptions): Provider {
    if (options.provider) return options.provider

    const host = resolveHost(options.host, process.env.GITLAB_HOST, glabHosts())
    const token = resolveToken(host, options.token, process.env.GITLAB_TOKEN, glabToken)
    return new GitLabProvider(host, token)
}

export async function collect(options: CollectOptions = {}): Promise<StandupReport> {
    return buildReport(resolveProvider(options), new Date(), options.lang ?? 'en')
}

export async function main(): Promise<void> {
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')
    const { StdioServerTransport } = await import(
        '@modelcontextprotocol/sdk/server/stdio.js'
    )

    const server = new McpServer({ name: 'standup-mr', version: '0.1.0' })

    server.tool(
        'get_standup_data',
        'Collect merge-request-based standup data from GitLab. Returns the previous ' +
            'working day activity, open merge requests bucketed by state ' +
            '(ready / blocked / draft / stale), pending reviews, and the error lines ' +
            'from any failed CI pipeline.',
        {},
        async () => {
            const report = await collect()
            return { content: [{ type: 'text' as const, text: JSON.stringify(report) }] }
        }
    )

    await server.connect(new StdioServerTransport())
}

const entry = process.argv[1]
if (entry && import.meta.url === pathToFileURL(entry).href) {
    main()
}
