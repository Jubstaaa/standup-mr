import { describe, expect, it } from 'bun:test'

import { toChatText } from './chat'

describe('toChatText', () => {
    it('escapes Slack control characters so a title cannot ping the channel', () => {
        expect(toChatText('- <!channel> fix: a & b <@U1> **x**', 'slack')).toBe(
            '- &lt;!channel&gt; fix: a &amp; b &lt;@U1&gt; *x*'
        )
    })

    it('breaks Google Chat mention syntax without entities it would show literally', () => {
        const text = toChatText('fix: <users/all> & a > b **x**', 'google-chat')

        expect(text).not.toContain('<users/all>')
        expect(text).toBe('fix: <\u2060users/all> & a > b *x*')
    })

    it('leaves Discord alone, since it speaks standard Markdown', () => {
        const md = '## Dün\n\n- **bold** and `code`'
        expect(toChatText(md, 'discord')).toBe(md)
    })

    for (const kind of ['slack', 'google-chat'] as const) {
        describe(kind, () => {
            it('turns Markdown bold into the single-asterisk form', () => {
                expect(toChatText('- **ready** today', kind)).toBe(
                    '- *ready* today'
                )
            })

            it('turns a heading into a bold line, since there are no headings', () => {
                expect(toChatText('## Dün — 1 Eylül', kind)).toBe(
                    '*Dün — 1 Eylül*'
                )
            })

            it('handles every heading level the note might use', () => {
                expect(toChatText('# A\n### B', kind)).toBe('*A*\n*B*')
            })

            it('leaves inline code alone', () => {
                expect(toChatText('job `quality` failed', kind)).toBe(
                    'job `quality` failed'
                )
            })

            it('leaves a fenced block and its contents alone', () => {
                const fenced = '```\n## not a heading\n**not bold**\n```'
                expect(toChatText(fenced, kind)).toBe(fenced)
            })

            it('leaves bullets and links as they are', () => {
                expect(toChatText('- [a](https://x/y)', kind)).toBe(
                    '- [a](https://x/y)'
                )
            })

            it('does not touch an asterisk that is not a bold marker', () => {
                expect(toChatText('2 * 3 = 6', kind)).toBe('2 * 3 = 6')
            })
        })
    }
})
