import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, spyOn } from 'bun:test'

import { main } from './cli'

const repoRoot = join(import.meta.dir, '..', '..')
const distCli = join(repoRoot, 'dist', 'cli.js')

function ensureBuilt(): boolean {
    if (existsSync(distCli)) return true
    try {
        execFileSync('bun', ['run', 'build'], { cwd: repoRoot, stdio: 'ignore' })
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

        const code = await main(['post', '--slack', 'https://hooks.example.com/a', '--text', '   '])

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

        const code = await main(['post', '--slack', 'https://hooks.example.com/a', '--text', 'hello'])

        expect(code).toBe(0)
        expect(fetchSpy).toHaveBeenCalledTimes(1)
        const [, init] = fetchSpy.mock.calls[0]!
        expect(JSON.parse(String((init as RequestInit).body))).toEqual({ text: 'hello' })
        stdout.mockRestore()
        stderr.mockRestore()
    })

    it('posts a discord payload under the content field, not text', async () => {
        const { stdout, stderr } = spyOutputs()
        const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response('ok', { status: 200 })
        )

        const code = await main(['post', '--discord', 'https://hooks.example.com/b', '--text', 'hi'])

        expect(code).toBe(0)
        expect(fetchSpy).toHaveBeenCalledTimes(1)
        const [, init] = fetchSpy.mock.calls[0]!
        expect(JSON.parse(String((init as RequestInit).body))).toEqual({ content: 'hi' })
        stdout.mockRestore()
        stderr.mockRestore()
    })

    it('prints markdown, not JSON, when --markdown is passed', async () => {
        const { stdout, stderr } = spyOutputs()
        const fakeFetch = (async (url: unknown) => {
            const target = String(url)
            if (target.includes('/api/v4/user')) {
                return new Response(JSON.stringify({ id: 1, username: 'dev' }), { status: 200 })
            }
            return new Response('[]', { status: 200 })
        }) as typeof fetch
        const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(fakeFetch)

        const code = await main([
            'fetch',
            '--host', 'gitlab.example.com',
            '--token', 'tkn',
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
                return new Response(JSON.stringify({ id: 1, login: 'dev' }), { status: 200 })
            }
            if (target.includes('search/issues')) {
                return new Response(JSON.stringify({ items: [] }), { status: 200 })
            }
            return new Response('[]', { status: 200 })
        }) as typeof fetch
        spyOn(globalThis, 'fetch').mockImplementation(fakeFetch)

        const code = await main([
            'fetch',
            '--provider', 'github',
            '--token', 'ghp',
        ])

        expect(code).toBe(0)
        expect(urls.some((url) => url.startsWith('https://api.github.com/'))).toBe(true)
        expect(String(stdout.mock.calls[0]![0])).toContain('"provider": "github"')
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
                const output = execFileSync('node', [link, '--help'], { encoding: 'utf8' })
                expect(output).toContain('standup')
            } finally {
                rmSync(dir, { recursive: true, force: true })
            }
        })
    }
})
