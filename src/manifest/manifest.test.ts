import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'bun:test'

import { findPackageRoot, packageVersion } from './manifest'

const temps: string[] = []

function scratch(): string {
    const dir = mkdtempSync(join(tmpdir(), 'standup-manifest-'))
    temps.push(dir)
    return dir
}

afterEach(() => {
    while (temps.length > 0) rmSync(temps.pop()!, { recursive: true, force: true })
})

describe('findPackageRoot', () => {
    it('walks up to the nearest directory holding a package.json', () => {
        const root = scratch()
        writeFileSync(join(root, 'package.json'), '{}')
        expect(findPackageRoot(join(root, 'dist', 'mcp'))).toBe(root)
    })

    it('throws naming the directory it started from when there is no package.json above', () => {
        const root = scratch()
        expect(() => findPackageRoot(root)).toThrow(new RegExp(root))
    })
})

describe('packageVersion', () => {
    it('reads the version out of the nearest package.json', () => {
        const root = scratch()
        writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '9.9.9' }))
        const moduleUrl = pathToFileURL(join(root, 'dist', 'mcp', 'server.js')).href
        expect(packageVersion(moduleUrl)).toBe('9.9.9')
    })

    it('throws when the manifest carries no version, rather than reporting a blank one', () => {
        const root = scratch()
        writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'x' }))
        const moduleUrl = pathToFileURL(join(root, 'dist', 'server.js')).href
        expect(() => packageVersion(moduleUrl)).toThrow(/no version/)
    })
})
