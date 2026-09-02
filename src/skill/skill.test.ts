import { describe, expect, it } from 'bun:test'

import { readStandupSkillBody } from './skill'

describe('readStandupSkillBody', () => {
    it('returns the skill body with its frontmatter stripped', () => {
        const body = readStandupSkillBody()

        expect(body.startsWith('---')).toBe(false)
        expect(body.startsWith('# Standup Note')).toBe(true)
    })

    it('carries the rules a caller needs, not just a heading', () => {
        expect(readStandupSkillBody().length).toBeGreaterThan(1000)
    })
})
