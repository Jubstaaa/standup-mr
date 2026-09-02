import { realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

import { ConfigError } from '../config/config'
import { findPackageRoot } from '../manifest/manifest'
import { postWebhook } from '../notify/notify'
import { WEBHOOK_KINDS } from '../notify/notify.constants'
import { connect } from '../providers/select'
import { toMarkdown } from '../render/render'
import { buildReport } from '../report/report'
import { readStandupSkillBody } from '../skill/skill'

import { USAGE } from './cli.constants'

async function readStdin(): Promise<string> {
    const chunks: Buffer[] = []
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
    return Buffer.concat(chunks).toString('utf8')
}

export async function main(argv: string[]): Promise<number> {
    const [command, ...rest] = argv

    if (!command || command === '--help' || command === '-h') {
        process.stdout.write(`${USAGE}\n`)
        return command ? 0 : 1
    }

    try {
        if (command === 'fetch') {
            const { values } = parseArgs({
                args: rest,
                options: {
                    provider: { type: 'string' },
                    host: { type: 'string' },
                    token: { type: 'string' },
                    lang: { type: 'string', default: 'en' },
                    markdown: { type: 'boolean', default: false },
                },
            })

            const report = await buildReport(
                connect(values),
                new Date(),
                values.lang
            )
            const output = values.markdown
                ? toMarkdown(report, values.lang)
                : JSON.stringify(report, null, 1)
            process.stdout.write(`${output}\n`)
            return 0
        }

        if (command === 'post') {
            const { values } = parseArgs({
                args: rest,
                options: {
                    ...Object.fromEntries(
                        WEBHOOK_KINDS.map(kind => [
                            kind,
                            { type: 'string' as const },
                        ])
                    ),
                    text: { type: 'string', default: '-' },
                },
            })

            // parseArgs cannot type options built from a list, so read the urls back
            // through one narrow assertion rather than one per flag.
            const urls = values as Record<string, string | undefined>
            const kind = WEBHOOK_KINDS.find(candidate => urls[candidate])
            if (!kind) {
                const flags = WEBHOOK_KINDS.map(
                    candidate => `--${candidate} URL`
                ).join(' | ')
                process.stderr.write(`Pass one of: ${flags}.\n`)
                return 1
            }
            const url = urls[kind]!

            const text = values.text === '-' ? await readStdin() : values.text
            if (!text.trim()) {
                process.stderr.write('Nothing to post: empty text.\n')
                return 1
            }

            await postWebhook(url, text, kind)
            return 0
        }

        if (command === 'mcp') {
            const moduleDir = dirname(fileURLToPath(import.meta.url))
            const serverPath = join(
                findPackageRoot(moduleDir),
                'dist',
                'mcp',
                'server.js'
            )
            const serverUrl = pathToFileURL(serverPath).href
            const { main: startMcpServer } = (await import(serverUrl)) as {
                main: () => Promise<void>
            }
            await startMcpServer()
            return 0
        }

        if (command === 'instructions') {
            process.stdout.write(readStandupSkillBody())
            return 0
        }

        process.stderr.write(`Unknown command: ${command}\n\n${USAGE}\n`)
        return 1
    } catch (error) {
        const message =
            error instanceof ConfigError || error instanceof Error
                ? error.message
                : String(error)
        process.stderr.write(`${message}\n`)
        return 1
    }
}

const entry = process.argv[1]
let entryUrl: string | undefined
try {
    entryUrl = entry ? pathToFileURL(realpathSync(entry)).href : undefined
} catch {
    entryUrl = undefined
}
if (entryUrl && import.meta.url === entryUrl) {
    main(process.argv.slice(2)).then(code => {
        process.exitCode = code
    })
}
