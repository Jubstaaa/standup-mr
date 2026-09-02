import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

import { packageVersion } from '../src/manifest/manifest'
import { inferWebhookKind, postWebhook } from '../src/notify/notify'
import { connect } from '../src/providers/select'
import { readStandupSkillBody } from '../src/skill/skill'
import type { Provider } from '../src/providers/base/base.types'
import { buildReport } from '../src/report/report'
import type { WebhookKind } from '../src/notify/notify.types'
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

export const WEBHOOK_URL_ENV = 'STANDUP_WEBHOOK_URL'

export const POST_TOOL_DESCRIPTION =
    'Posts a finished standup note to a chat webhook. This one has a side effect: it ' +
    'sends a message other people will see, so only call it on a note the user has ' +
    `agreed to send.\n\nThe webhook URL is read from ${WEBHOOK_URL_ENV}, never from an ` +
    'argument — a webhook URL is a credential, since anyone holding it can post to the ' +
    'channel. Slack and Discord payload shapes are supported; the shape is inferred from ' +
    'the URL host, and `kind` is only needed for a proxied or self-hosted endpoint whose ' +
    'host gives nothing away — Mattermost and Rocket.Chat take the slack shape. A missing URL, an unrecognised host, or a webhook that ' +
    'rejects the message comes back as an error rather than a silent success.'

export const POST_TOOL_SCHEMA = {
    text: z
        .string()
        .min(1)
        .describe(
            'The note to post, as the chat should render it. Slack and Discord both take ' +
                'Markdown, so send the written note rather than the raw JSON from ' +
                'get_standup_data.'
        ),
    kind: z
        .enum(['slack', 'discord', 'google-chat'])
        .optional()
        .describe(
            'Which payload shape to send: slack and google-chat post {"text"}, discord ' +
                'posts {"content"}. Omit it — the shape is inferred from the webhook ' +
                'host. ' +
                'Pass it only when the host is not recognisable, e.g. a proxy in front of ' +
                'the real webhook.'
        ),
}

export const INSTRUCTIONS_TOOL_DESCRIPTION =
    'Returns the note-writing rules — the playbook for turning get_standup_data output ' +
    'into a standup note a person would actually say out loud: how to group the previous ' +
    'day by theme, how to derive today from open merge requests, and how to report a ' +
    'blocker from its job log. Read-only, no arguments, no network. Call it once before ' +
    'writing the first note; the rules do not change between calls.'

export type PostToolArgs = z.infer<z.ZodObject<typeof POST_TOOL_SCHEMA>>

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: true }

function text(body: string): ToolResult {
    return { content: [{ type: 'text' as const, text: body }] }
}

function failure(body: string): ToolResult {
    return { content: [{ type: 'text' as const, text: body }], isError: true }
}

export interface PostToolDeps {
    env?: Record<string, string | undefined>
    post?: (url: string, body: string, kind: WebhookKind) => Promise<void>
}

export async function runPostTool(
    args: PostToolArgs,
    deps: PostToolDeps = {}
): Promise<ToolResult> {
    const env = deps.env ?? process.env
    const post = deps.post ?? postWebhook

    const url = env[WEBHOOK_URL_ENV]
    if (!url) {
        return failure(
            `No webhook configured. Set ${WEBHOOK_URL_ENV} to the Slack or Discord ` +
                'webhook URL; it is deliberately not accepted as a tool argument.'
        )
    }

    const kind = args.kind ?? inferWebhookKind(url)
    if (!kind) {
        return failure(
            `Could not tell from the ${WEBHOOK_URL_ENV} host whether this is a Slack or a ` +
                'Discord webhook. Pass kind explicitly.'
        )
    }

    try {
        await post(url, args.text, kind)
    } catch (cause) {
        const detail = cause instanceof Error ? cause.message : String(cause)
        return failure(`The ${kind} webhook did not accept the note: ${detail}`)
    }

    return text(`Posted the note to the configured ${kind} webhook.`)
}

export async function runInstructionsTool(): Promise<ToolResult> {
    return text(readStandupSkillBody())
}

export async function main(): Promise<void> {
    const server = new McpServer({ name: 'standup-mr', version: packageVersion(import.meta.url) })

    server.tool(
        'get_standup_data',
        STANDUP_TOOL_DESCRIPTION,
        STANDUP_TOOL_SCHEMA,
        async (args) => await runStandupTool(args)
    )

    server.tool('post_standup_note', POST_TOOL_DESCRIPTION, POST_TOOL_SCHEMA, async (args) =>
        await runPostTool(args)
    )

    server.tool('get_note_instructions', INSTRUCTIONS_TOOL_DESCRIPTION, {}, async () =>
        await runInstructionsTool()
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
