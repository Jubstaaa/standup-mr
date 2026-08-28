import { parseArgs } from 'node:util'

import { USAGE } from './cli.constants'
import { ConfigError, glabHosts, glabToken, resolveHost, resolveToken } from './config'
import { postWebhook } from './notify'
import { GitLabProvider } from './providers/gitlab'
import { toMarkdown } from './render'
import { buildReport } from './report'

async function readStdin(): Promise<string> {
    const chunks: Buffer[] = []
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
    return Buffer.concat(chunks).toString('utf8')
}

function connect(values: { host?: string; token?: string }): GitLabProvider {
    const host = resolveHost(values.host, process.env.GITLAB_HOST, glabHosts())
    const token = resolveToken(host, values.token, process.env.GITLAB_TOKEN, glabToken)
    return new GitLabProvider(host, token)
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

main(process.argv.slice(2)).then((code) => {
    process.exitCode = code
})
