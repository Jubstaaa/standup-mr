import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

import { packageVersion } from '../src/manifest/manifest'
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

export const STANDUP_TOOL_DESCRIPTION =
    'Collect merge-request-based standup data from GitLab or GitHub. Returns one JSON ' +
    'object: `today`, `previousDays[]` with the events of each, `todayEvents[]`, ' +
    '`myMrs[]` bucketed ready / blocked / draft / stale, `reviews[]` waiting on you, and ' +
    '`blockers[]` carrying the error lines read out of each failed pipeline job log.\n\n' +
    'Call it once at the start of a working day, to write a standup note. It is a ' +
    'snapshot, not a search API: it cannot fetch one named merge request, reach further ' +
    'back than the previous working day, or filter by project.\n\n' +
    'Read-only, and credentials never come from an argument — they come from the ' +
    'environment or a logged-in gh / glab session. A rejected token, a refused resource ' +
    'or a rate limit fails the call with the host\'s own message, after two retries on ' +
    'transient server errors. A blocker whose diagnosis could not be fetched is still ' +
    'returned, with `job: "unknown"`, so a red pipeline is never silently dropped.'

export const STANDUP_TOOL_SCHEMA = {
    provider: z
        .enum(['github', 'gitlab'])
        .optional()
        .describe(
            'Which provider to read. Omit to auto-detect, in this order: a recognisable ' +
                'host, STANDUP_PROVIDER, a GITHUB_*/GITLAB_* environment pair, then whichever ' +
                'of the gh / glab CLIs is logged in. Pass it when both are configured — ' +
                'ambiguity fails the call rather than being guessed at.'
        ),
    host: z
        .string()
        .optional()
        .describe(
            'Self-hosted host, without a scheme, e.g. gitlab.example.com or ' +
                'github.example.com. Required for GitLab, which has no default host; ' +
                'optional for GitHub, which defaults to github.com. A recognisable host ' +
                'also settles `provider` on its own, so the two are rarely both needed.'
        ),
    lang: z
        .enum(['en', 'tr'])
        .optional()
        .describe(
            'Language for the date labels inside the returned JSON: en (default) or tr. ' +
                'It relabels dates and nothing else — no field is translated, and the ' +
                'standup note itself is written by the caller, in whatever language they ' +
                'are speaking.'
        ),
}

export type StandupToolArgs = z.infer<z.ZodObject<typeof STANDUP_TOOL_SCHEMA>>

type Collector = (options: CollectOptions) => Promise<StandupReport>

export async function runStandupTool(
    args: StandupToolArgs,
    collector: Collector = collect
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
    // Only the three declared options reach the collector. A token is never
    // accepted as a tool argument — credentials belong in the environment,
    // not in a transcript.
    const report = await collector({
        provider: args.provider,
        host: args.host,
        lang: args.lang,
    })
    return { content: [{ type: 'text' as const, text: JSON.stringify(report) }] }
}

export async function main(): Promise<void> {
    const server = new McpServer({ name: 'standup-mr', version: packageVersion(import.meta.url) })

    server.tool(
        'get_standup_data',
        STANDUP_TOOL_DESCRIPTION,
        STANDUP_TOOL_SCHEMA,
        async (args) => await runStandupTool(args)
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
