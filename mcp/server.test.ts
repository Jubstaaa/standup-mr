import { describe, expect, it } from 'bun:test'

import { WEBHOOK_KINDS } from '../src/notify/notify.constants'
import type { Provider } from '../src/providers/base/base.types'
import {
    INSTRUCTIONS_TOOL_DESCRIPTION,
    POST_TOOL_DESCRIPTION,
    POST_TOOL_SCHEMA,
    STANDUP_TOOL_DESCRIPTION,
    STANDUP_TOOL_SCHEMA,
    WEBHOOK_URL_ENV,
    collect,
    runInstructionsTool,
    runPostTool,
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

describe('POST_TOOL_SCHEMA', () => {
    it('takes the note text and, optionally, which payload shape to send', () => {
        expect(Object.keys(POST_TOOL_SCHEMA).sort()).toEqual(['kind', 'text'])
    })

    it('requires the text, since there is nothing to post without it', () => {
        expect(POST_TOOL_SCHEMA.text.safeParse(undefined).success).toBe(false)
        expect(POST_TOOL_SCHEMA.text.safeParse('note').success).toBe(true)
    })

    it('offers exactly the kinds the notifier implements, no more and no fewer', () => {
        for (const kind of WEBHOOK_KINDS) {
            expect(POST_TOOL_SCHEMA.kind.safeParse(kind).success).toBe(true)
        }
        expect(POST_TOOL_SCHEMA.kind.safeParse('teams').success).toBe(false)
        expect(Object.keys(POST_TOOL_SCHEMA.kind.unwrap().enum).sort()).toEqual(
            [...WEBHOOK_KINDS].sort()
        )
    })

    it('rejects a kind that is not implemented', () => {
        expect(POST_TOOL_SCHEMA.kind.safeParse('teams').success).toBe(false)
    })

    it('never takes the webhook url as an argument', () => {
        expect(Object.keys(POST_TOOL_SCHEMA)).not.toContain('url')
        expect(JSON.stringify(POST_TOOL_SCHEMA)).not.toMatch(/https?:/)
    })
})

describe('POST_TOOL_DESCRIPTION', () => {
    it('discloses that the tool sends something, since that is a side effect', () => {
        expect(POST_TOOL_DESCRIPTION).toMatch(/posts|sends/i)
    })

    it('names the environment variable the url comes from', () => {
        expect(POST_TOOL_DESCRIPTION).toContain(WEBHOOK_URL_ENV)
    })
})

describe('runPostTool', () => {
    const env = (url?: string) => (url ? { [WEBHOOK_URL_ENV]: url } : {})

    it('posts the text to the url from the environment', async () => {
        const seen: Array<[string, string, string]> = []
        const result = await runPostTool({ text: 'note' }, {
            env: env('https://hooks.slack.com/services/T0/B0/x'),
            post: async (url, text, kind) => {
                seen.push([url, text, kind])
            },
        })

        expect(seen).toEqual([['https://hooks.slack.com/services/T0/B0/x', 'note', 'slack']])
        expect(result.isError).toBeUndefined()
    })

    it('infers discord from the url when kind is omitted', async () => {
        let kind = ''
        await runPostTool({ text: 'note' }, {
            env: env('https://discord.com/api/webhooks/1/x'),
            post: async (_u, _t, k) => {
                kind = k
            },
        })

        expect(kind).toBe('discord')
    })

    it('lets an explicit kind win over the inferred one', async () => {
        let kind = ''
        await runPostTool({ text: 'note', kind: 'slack' }, {
            env: env('https://discord.com/api/webhooks/1/x'),
            post: async (_u, _t, k) => {
                kind = k
            },
        })

        expect(kind).toBe('slack')
    })

    it('fails loudly when the environment carries no webhook url', async () => {
        let called = false
        const result = await runPostTool({ text: 'note' }, {
            env: env(),
            post: async () => {
                called = true
            },
        })

        expect(called).toBe(false)
        expect(result.isError).toBe(true)
        expect(result.content[0]!.text).toContain(WEBHOOK_URL_ENV)
    })

    it('asks for a kind rather than guessing when the host is unknown', async () => {
        let called = false
        const result = await runPostTool({ text: 'note' }, {
            env: env('https://hooks.example.com/abc'),
            post: async () => {
                called = true
            },
        })

        expect(called).toBe(false)
        expect(result.isError).toBe(true)
        expect(result.content[0]!.text).toMatch(/kind/i)
    })

    it('reports a rejected webhook instead of claiming the note was posted', async () => {
        const result = await runPostTool({ text: 'note' }, {
            env: env('https://hooks.slack.com/services/T0/B0/x'),
            post: async () => {
                throw new Error('Webhook rejected the message: HTTP 404.')
            },
        })

        expect(result.isError).toBe(true)
        expect(result.content[0]!.text).toContain('404')
    })

    it('never echoes the webhook url back to the caller', async () => {
        const url = 'https://hooks.slack.com/services/T0/B0/supersecret'
        const result = await runPostTool({ text: 'note' }, {
            env: env(url),
            post: async () => {},
        })

        expect(JSON.stringify(result)).not.toContain('supersecret')
    })
})

describe('runInstructionsTool', () => {
    it('returns the note-writing rules as text', async () => {
        const result = await runInstructionsTool()

        expect(result.content[0]!.type).toBe('text')
        expect(result.content[0]!.text.startsWith('# Standup Note')).toBe(true)
    })

    it('says the rules are the note-writing playbook, not data', () => {
        expect(INSTRUCTIONS_TOOL_DESCRIPTION).toMatch(/rules|playbook/i)
    })
})
