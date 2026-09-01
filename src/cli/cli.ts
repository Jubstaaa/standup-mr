import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

import { USAGE } from './cli.constants'
import { findPackageRoot } from '../manifest/manifest'
import { ConfigError } from '../config/config'
import { postWebhook } from '../notify/notify'
import { connect } from '../providers/select'
import { toMarkdown } from '../render/render'
import { buildReport } from '../report/report'

async function readStdin(): Promise<string> {
    const chunks: Buffer[] = []
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
    return Buffer.concat(chunks).toString('utf8')
}

function readStandupSkillBody(): string {
    const moduleDir = dirname(fileURLToPath(import.meta.url))
    const skillPath = join(findPackageRoot(moduleDir), 'skills', 'standup', 'SKILL.md')

    if (!existsSync(skillPath)) {
        throw new Error(`Cannot find the standup skill file at ${skillPath}`)
    }

    const content = readFileSync(skillPath, 'utf8')
    const withoutFrontmatter = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')
    return withoutFrontmatter.replace(/^\n+/, '')
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

            const report = await buildReport(connect(values), new Date(), values.lang)
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
                    slack: { type: 'string' },
                    discord: { type: 'string' },
                    text: { type: 'string', default: '-' },
                },
            })

            const url = values.slack ?? values.discord
            if (!url) {
                process.stderr.write('Pass --slack URL or --discord URL.\n')
                return 1
            }

            const text = values.text === '-' ? await readStdin() : values.text
            if (!text.trim()) {
                process.stderr.write('Nothing to post: empty text.\n')
                return 1
            }

            await postWebhook(url, text, values.slack ? 'slack' : 'discord')
            return 0
        }

        if (command === 'mcp') {
            const moduleDir = dirname(fileURLToPath(import.meta.url))
            const serverPath = join(findPackageRoot(moduleDir), 'dist', 'mcp', 'server.js')
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
    main(process.argv.slice(2)).then((code) => {
        process.exitCode = code
    })
}
