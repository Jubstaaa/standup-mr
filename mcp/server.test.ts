import { describe, expect, it } from 'bun:test'

import type { Provider } from '../src/providers/base/base.types'
import {
    STANDUP_TOOL_DESCRIPTION,
    STANDUP_TOOL_SCHEMA,
    collect,
    runStandupTool,
} from './server'

const fakeProvider: Provider = {
    kind: 'gitlab',
    getIdentity: async () => ({ id: 1, username: 'dev' }),
    getEvents: async () => [],
    getMyMrs: async () => [],
    getReviews: async () => [],
    getBlockers: async () => [],
}

describe('collect', () => {
    it('builds a report from an injected provider', async () => {
        const report = await collect({ providerImpl: fakeProvider })

        expect(report.user).toBe('dev')
        expect(report).toHaveProperty('reviewPendingCount')
        expect(report.today.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })

    it('passes the language through', async () => {
        const en = await collect({ providerImpl: fakeProvider, lang: 'en' })
        const tr = await collect({ providerImpl: fakeProvider, lang: 'tr' })

        expect(en.today.label).not.toBe(tr.today.label)
    })
})

describe('STANDUP_TOOL_SCHEMA', () => {
    it('offers the three options a caller can actually choose', () => {
        expect(Object.keys(STANDUP_TOOL_SCHEMA).sort()).toEqual(['host', 'lang', 'provider'])
    })

    it('constrains provider to the two implemented providers', () => {
        expect(STANDUP_TOOL_SCHEMA.provider.safeParse('github').success).toBe(true)
        expect(STANDUP_TOOL_SCHEMA.provider.safeParse('gitlab').success).toBe(true)
        expect(STANDUP_TOOL_SCHEMA.provider.safeParse('bitbucket').success).toBe(false)
    })

    it('constrains lang to the two languages with date labels', () => {
        expect(STANDUP_TOOL_SCHEMA.lang.safeParse('tr').success).toBe(true)
        expect(STANDUP_TOOL_SCHEMA.lang.safeParse('de').success).toBe(false)
    })

    it('leaves every option optional, so an argument-free call still works', () => {
        for (const field of Object.values(STANDUP_TOOL_SCHEMA)) {
            expect(field.safeParse(undefined).success).toBe(true)
        }
    })

    it('describes every option, since the description is what a model reads', () => {
        for (const field of Object.values(STANDUP_TOOL_SCHEMA)) {
            expect(field.description ?? '').not.toBe('')
        }
    })
})

describe('runStandupTool', () => {
    it('forwards the caller options to the collector', async () => {
        let seen: Record<string, unknown> | undefined
        await runStandupTool({ provider: 'github', host: 'gh.example.com', lang: 'tr' }, async (
            options
        ) => {
            seen = options as Record<string, unknown>
            return await collect({ providerImpl: fakeProvider })
        })

        expect(seen).toEqual({ provider: 'github', host: 'gh.example.com', lang: 'tr' })
    })

    it('never forwards a token, so a credential cannot arrive as a tool argument', async () => {
        let seen: Record<string, unknown> | undefined
        await runStandupTool(
            { provider: 'github', token: 'glpat-secret' } as Record<string, string>,
            async (options) => {
                seen = options as Record<string, unknown>
                return await collect({ providerImpl: fakeProvider })
            }
        )

        expect(seen).not.toHaveProperty('token')
        expect(JSON.stringify(seen)).not.toContain('glpat-secret')
    })

    it('returns the report as MCP text content', async () => {
        const result = await runStandupTool({}, async () =>
            await collect({ providerImpl: fakeProvider })
        )

        expect(result.content[0]!.type).toBe('text')
        expect(JSON.parse(result.content[0]!.text).user).toBe('dev')
    })
})

describe('STANDUP_TOOL_DESCRIPTION', () => {
    it('names every collection the report actually returns', () => {
        for (const key of ['previousDays', 'todayEvents', 'myMrs', 'reviews', 'blockers']) {
            expect(STANDUP_TOOL_DESCRIPTION).toContain(key)
        }
    })

    it('names all four buckets a merge request can land in', () => {
        for (const bucket of ['ready', 'blocked', 'draft', 'stale']) {
            expect(STANDUP_TOOL_DESCRIPTION).toContain(bucket)
        }
    })

    it('states the credential rule the handler enforces', () => {
        expect(STANDUP_TOOL_DESCRIPTION).toMatch(/never come from an argument/i)
    })

    it('states the degradation the blocker path actually performs', () => {
        expect(STANDUP_TOOL_DESCRIPTION).toContain('job: "unknown"')
    })

    it('says when the tool does not apply, not only what it does', () => {
        expect(STANDUP_TOOL_DESCRIPTION).toMatch(/not a search api/i)
    })

    it('stays scannable rather than turning into a manual', () => {
        expect(STANDUP_TOOL_DESCRIPTION.length).toBeLessThan(1200)
    })
})

describe('STANDUP_TOOL_SCHEMA parameter semantics', () => {
    it('says GitLab needs a host and GitHub does not', () => {
        expect(STANDUP_TOOL_SCHEMA.host.description).toMatch(/required for gitlab/i)
        expect(STANDUP_TOOL_SCHEMA.host.description).toMatch(/defaults to github\.com/i)
    })

    it('warns that an ambiguous provider fails rather than being guessed', () => {
        expect(STANDUP_TOOL_SCHEMA.provider.description).toMatch(/fails|error/i)
    })

    it('says lang only relabels dates', () => {
        expect(STANDUP_TOOL_SCHEMA.lang.description).toMatch(/relabel|label/i)
    })
})
