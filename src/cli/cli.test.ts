import { afterEach, describe, expect, it, spyOn } from 'bun:test'

import { main } from './cli'

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
})
