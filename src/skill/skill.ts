import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { findPackageRoot } from '../manifest/manifest'

export function readStandupSkillBody(): string {
    const moduleDir = dirname(fileURLToPath(import.meta.url))
    const skillPath = join(
        findPackageRoot(moduleDir),
        'skills',
        'standup',
        'SKILL.md'
    )

    if (!existsSync(skillPath)) {
        throw new Error(`Cannot find the standup skill file at ${skillPath}`)
    }

    const content = readFileSync(skillPath, 'utf8')
    const withoutFrontmatter = content.replace(
        /^---\r?\n[\s\S]*?\r?\n---\r?\n/,
        ''
    )
    return withoutFrontmatter.replace(/^\n+/, '')
}
