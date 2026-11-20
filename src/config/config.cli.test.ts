import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { ConfigError, ghToken, glabToken } from './config'

// Real stand-in executables on PATH, so the test exercises how
// execFileSync actually reports a missing binary, an exit code or a signal.
let bin: string
let savedPath: string | undefined

function fakeCli(name: string, script: string): void {
    const file = join(bin, name)
    writeFileSync(file, `#!/bin/sh\n${script}\n`)
    chmodSync(file, 0o755)
}

beforeEach(() => {
    bin = mkdtempSync(join(tmpdir(), 'standup-cli-'))
    savedPath = process.env.PATH
    process.env.PATH = bin
})

afterEach(() => {
    process.env.PATH = savedPath
    rmSync(bin, { force: true, recursive: true })
})

describe('reading a token from the provider cli', () => {
    it('returns the trimmed token', () => {
        fakeCli('gh', 'echo "  tok-123  "')
        expect(ghToken('github.com')).toBe('tok-123')
    })

    it('treats a cli that is not installed as no token', () => {
        expect(glabToken('gitlab.com')).toBe('')
    })

    it('treats a non-zero exit, such as not logged in, as no token', () => {
        fakeCli('gh', 'echo "not logged in" >&2; exit 1')
        expect(ghToken('github.com')).toBe('')
    })

    it('surfaces a cli that was killed instead of reporting no token', () => {
        fakeCli('glab', 'kill -TERM $$')
        expect(() => glabToken('gitlab.com')).toThrow(ConfigError)
        expect(() => glabToken('gitlab.com')).toThrow(/glab.*SIGTERM/)
    })
})
