import { execFileSync, spawn } from 'node:child_process'
import {
    cpSync,
    existsSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, spyOn } from 'bun:test'

import { main } from './cli'

const repoRoot = join(import.meta.dir, '..', '..')
const distCli = join(repoRoot, 'dist', 'cli.js')

function ensureBuilt(): boolean {
    if (existsSync(distCli)) return true
    try {
        execFileSync('bun', ['run', 'build'], {
            cwd: repoRoot,
            stdio: 'ignore',
        })
    } catch {
        return false
    }
    return existsSync(distCli)
}

const canRunSymlinkTest = ensureBuilt()

function spyOutputs() {
    const stdout = spyOn(process.stdout, 'write').mockImplementation(() => true)
    const stderr = spyOn(process.stderr, 'write').mockImplementation(() => true)
    return { stdout, stderr }
}

describe('main', () => {
    afterEach(() => {
        spyOn(process.stdout, 'write').mockRestore()
        spyOn(process.stderr, 'write').mockRestore()
        spyOn(globalThis, 'fetch').mockRestore()
    })

    it('prints usage and returns 1 for a bare invocation', async () => {
        const { stdout, stderr } = spyOutputs()

        const code = await main([])

        expect(code).toBe(1)
        expect(stdout).toHaveBeenCalled()
        expect(String(stdout.mock.calls[0]![0])).toContain('standup')
        stdout.mockRestore()
        stderr.mockRestore()
    })

    it('prints usage and returns 0 for --help', async () => {
        const { stdout, stderr } = spyOutputs()

        const code = await main(['--help'])

        expect(code).toBe(0)
        expect(String(stdout.mock.calls[0]![0])).toContain('standup')
        stdout.mockRestore()
        stderr.mockRestore()
    })

    it('names an unknown command on stderr and returns 1', async () => {
        const { stdout, stderr } = spyOutputs()

        const code = await main(['bogus'])

        expect(code).toBe(1)
        expect(String(stderr.mock.calls[0]![0])).toContain('bogus')
        stdout.mockRestore()
        stderr.mockRestore()
    })

    it('returns 1 for post without --slack or --discord', async () => {
        const { stdout, stderr } = spyOutputs()
        const fetchSpy = spyOn(globalThis, 'fetch').mockRejectedValue(
            new Error('fetch must not be called without --slack or --discord')
        )

        const code = await main(['post', '--text', 'hello'])

        expect(code).toBe(1)
        expect(fetchSpy).not.toHaveBeenCalled()
        stdout.mockRestore()
        stderr.mockRestore()
    })

    it('returns 1 for post with whitespace-only text', async () => {
        const { stdout, stderr } = spyOutputs()
        const fetchSpy = spyOn(globalThis, 'fetch').mockRejectedValue(
            new Error('fetch must not be called for whitespace-only text')
        )

        const code = await main([
            'post',
            '--slack',
            'https://hooks.example.com/a',
            '--text',
            '   ',
        ])

        expect(code).toBe(1)
        expect(fetchSpy).not.toHaveBeenCalled()
        stdout.mockRestore()
        stderr.mockRestore()
    })

    it('posts a slack payload under the text field', async () => {
        const { stdout, stderr } = spyOutputs()
        const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response('ok', { status: 200 })
        )

        const code = await main([
            'post',
            '--slack',
            'https://hooks.example.com/a',
            '--text',
            'hello',
        ])

        expect(code).toBe(0)
        expect(fetchSpy).toHaveBeenCalledTimes(1)
        const [, init] = fetchSpy.mock.calls[0]!
        expect(JSON.parse(String((init as RequestInit).body))).toEqual({
            text: 'hello',
        })
        stdout.mockRestore()
        stderr.mockRestore()
    })

    it('posts a discord payload under the content field, not text', async () => {
        const { stdout, stderr } = spyOutputs()
        const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response('ok', { status: 200 })
        )

        const code = await main([
            'post',
            '--discord',
            'https://hooks.example.com/b',
            '--text',
            'hi',
        ])

        expect(code).toBe(0)
        expect(fetchSpy).toHaveBeenCalledTimes(1)
        const [, init] = fetchSpy.mock.calls[0]!
        expect(JSON.parse(String((init as RequestInit).body))).toEqual({
            content: 'hi',
        })
        stdout.mockRestore()
        stderr.mockRestore()
    })

    it('prints markdown, not JSON, when --markdown is passed', async () => {
        const { stdout, stderr } = spyOutputs()
        const fakeFetch = (async (url: unknown) => {
            const target = String(url)
            if (target.includes('/api/v4/user')) {
                return new Response(
                    JSON.stringify({ id: 1, username: 'dev' }),
                    { status: 200 }
                )
            }
            return new Response('[]', { status: 200 })
        }) as typeof fetch
        const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(
            fakeFetch
        )

        const code = await main([
            'fetch',
            '--host',
            'gitlab.example.com',
            '--token',
            'tkn',
            '--markdown',
        ])

        expect(code).toBe(0)
        expect(fetchSpy).toHaveBeenCalled()
        const output = String(stdout.mock.calls[0]![0])
        expect(output.startsWith('# ')).toBe(true)
        expect(() => JSON.parse(output)).toThrow()
        stdout.mockRestore()
        stderr.mockRestore()
    })

    it('routes --provider github to the github api', async () => {
        const { stdout, stderr } = spyOutputs()
        const urls: string[] = []
        const fakeFetch = (async (url: unknown) => {
            const target = String(url)
            urls.push(target)
            if (target.endsWith('/user')) {
                return new Response(JSON.stringify({ id: 1, login: 'dev' }), {
                    status: 200,
                })
            }
            if (target.includes('search/issues')) {
                return new Response(JSON.stringify({ items: [] }), {
                    status: 200,
                })
            }
            return new Response('[]', { status: 200 })
        }) as typeof fetch
        spyOn(globalThis, 'fetch').mockImplementation(fakeFetch)

        const code = await main([
            'fetch',
            '--provider',
            'github',
            '--host',
            'github.com',
            '--token',
            'ghp',
        ])

        expect(code).toBe(0)
        expect(
            urls.some(url => url.startsWith('https://api.github.com/'))
        ).toBe(true)
        expect(String(stdout.mock.calls[0]![0])).toContain(
            '"provider": "github"'
        )
        stdout.mockRestore()
        stderr.mockRestore()
    })

    it('names both providers in the usage text', async () => {
        const { stdout, stderr } = spyOutputs()

        await main(['--help'])

        const usage = String(stdout.mock.calls[0]![0])
        expect(usage).toContain('--provider')
        expect(usage).toContain('GITHUB_TOKEN')
        stdout.mockRestore()
        stderr.mockRestore()
    })

    it('prints the standup skill body, without its YAML frontmatter, for instructions', async () => {
        const { stdout, stderr } = spyOutputs()

        const code = await main(['instructions'])

        expect(code).toBe(0)
        const output = String(stdout.mock.calls[0]![0])
        expect(output.startsWith('---')).toBe(false)
        expect(output).not.toContain('name: standup')
        expect(output).toContain('# Standup Note')
        expect(output.startsWith('# Standup Note')).toBe(true)
        stdout.mockRestore()
        stderr.mockRestore()
    })
})

describe('symlinked entry point', () => {
    if (!canRunSymlinkTest) {
        it.skip('runs through a symlink like node_modules/.bin does (dist/cli.js missing and `bun run build` failed)', () => {})
    } else {
        it('prints usage and exits 0 when invoked through a symlink, like node_modules/.bin does', () => {
            const dir = mkdtempSync(join(tmpdir(), 'standup-mr-symlink-'))
            const link = join(dir, 'standup')
            symlinkSync(distCli, link)

            try {
                const output = execFileSync('node', [link, '--help'], {
                    encoding: 'utf8',
                })
                expect(output).toContain('standup')
            } finally {
                rmSync(dir, { recursive: true, force: true })
            }
        })

        it('still finds the standup skill file for instructions when invoked through a symlink', () => {
            const dir = mkdtempSync(join(tmpdir(), 'standup-mr-symlink-'))
            const link = join(dir, 'standup')
            symlinkSync(distCli, link)

            try {
                const output = execFileSync('node', [link, 'instructions'], {
                    encoding: 'utf8',
                })
                expect(output).toContain('# Standup Note')
                expect(output).not.toContain('name: standup')
            } finally {
                rmSync(dir, { recursive: true, force: true })
            }
        })
    }
})

describe('instructions command failure', () => {
    if (!canRunSymlinkTest) {
        it.skip('fails loudly, naming the path, when the skill file is missing (dist/cli.js missing and `bun run build` failed)', () => {})
    } else {
        it('fails loudly, naming the path it looked for, when the skill file is missing', () => {
            const dir = mkdtempSync(join(tmpdir(), 'standup-mr-missing-skill-'))
            cpSync(join(repoRoot, 'dist'), join(dir, 'dist'), {
                recursive: true,
            })
            writeFileSync(
                join(dir, 'package.json'),
                JSON.stringify({ type: 'module' })
            )
            const fakeCli = join(dir, 'dist', 'cli.js')

            try {
                execFileSync('node', [fakeCli, 'instructions'], {
                    stdio: ['ignore', 'pipe', 'pipe'],
                })
                throw new Error(
                    'expected `instructions` to exit non-zero when the skill file is missing'
                )
            } catch (error) {
                const failure = error as { status?: number; stderr?: Buffer }
                expect(failure.status).toBe(1)
                expect(String(failure.stderr)).toContain(
                    join(dir, 'skills', 'standup', 'SKILL.md')
                )
            } finally {
                rmSync(dir, { recursive: true, force: true })
            }
        })
    }
})

describe('mcp command', () => {
    if (!canRunSymlinkTest) {
        it.skip('speaks MCP over stdio and writes nothing else to stdout (dist/cli.js missing and `bun run build` failed)', () => {})
    } else {
        it('speaks MCP over stdio and writes nothing else to stdout', async () => {
            const child = spawn('node', [distCli, 'mcp'], {
                stdio: ['pipe', 'pipe', 'pipe'],
            })
            const lines: string[] = []
            let buffer = ''

            child.stdout.on('data', (chunk: Buffer) => {
                buffer += chunk.toString('utf8')
                let index: number
                while ((index = buffer.indexOf('\n')) !== -1) {
                    lines.push(buffer.slice(0, index))
                    buffer = buffer.slice(index + 1)
                }
            })

            function send(message: unknown) {
                child.stdin.write(`${JSON.stringify(message)}\n`)
            }

            function waitForLines(
                count: number,
                timeoutMs = 5000
            ): Promise<void> {
                return new Promise((resolve, reject) => {
                    const start = Date.now()
                    const timer = setInterval(() => {
                        if (lines.length >= count) {
                            clearInterval(timer)
                            resolve()
                        } else if (Date.now() - start > timeoutMs) {
                            clearInterval(timer)
                            reject(
                                new Error(
                                    'timed out waiting for the mcp server to respond'
                                )
                            )
                        }
                    }, 20)
                })
            }

            try {
                send({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'initialize',
                    params: {
                        protocolVersion: '2024-11-05',
                        capabilities: {},
                        clientInfo: {
                            name: 'standup-mr-test',
                            version: '1.0.0',
                        },
                    },
                })
                await waitForLines(1)

                send({ jsonrpc: '2.0', method: 'notifications/initialized' })
                send({
                    jsonrpc: '2.0',
                    id: 2,
                    method: 'tools/list',
                    params: {},
                })
                await waitForLines(2)

                const initResponse = JSON.parse(lines[0]!)
                expect(initResponse.result.serverInfo.name).toBe('standup-mr')
                expect(initResponse.result.serverInfo.version).toBe(
                    JSON.parse(
                        readFileSync(join(repoRoot, 'package.json'), 'utf8')
                    ).version
                )

                const toolsResponse = JSON.parse(lines[1]!)
                const toolNames = (
                    toolsResponse.result.tools as Array<{ name: string }>
                ).map(tool => tool.name)
                expect(toolNames.sort()).toEqual([
                    'get_note_instructions',
                    'get_standup_data',
                    'post_standup_note',
                ])

                const tool = (
                    toolsResponse.result.tools as Array<{
                        name: string
                        inputSchema: { properties?: Record<string, unknown> }
                    }>
                ).find(row => row.name === 'get_standup_data')!
                expect(
                    Object.keys(tool.inputSchema.properties ?? {}).sort()
                ).toEqual(['host', 'lang', 'provider'])
                expect(JSON.stringify(tool.inputSchema)).not.toMatch(/token/i)

                expect(lines).toHaveLength(2)
            } finally {
                child.kill()
            }
        }, 10000)
    }
})
