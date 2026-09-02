import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export function findPackageRoot(startDir: string): string {
    let dir = startDir
    while (!existsSync(join(dir, 'package.json'))) {
        const parent = dirname(dir)
        if (parent === dir) {
            throw new Error(`Could not locate package.json above ${startDir}`)
        }
        dir = parent
    }
    return dir
}

export function packageVersion(moduleUrl: string): string {
    const root = findPackageRoot(dirname(fileURLToPath(moduleUrl)))
    const manifest = JSON.parse(
        readFileSync(join(root, 'package.json'), 'utf8')
    ) as {
        version?: string
    }
    if (!manifest.version) {
        throw new Error(`package.json at ${root} has no version`)
    }
    return manifest.version
}
