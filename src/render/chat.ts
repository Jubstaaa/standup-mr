import type { WebhookKind } from '../notify/notify.types'

const MARKDOWN_NATIVE: readonly WebhookKind[] = ['discord']

const FENCE = /^```/

// Slack reads <...> as control sequences (<!channel>, <@U1>, links), so a
// merge request title could ping a whole channel. Slack documents escaping
// exactly these three characters; an HTML escaper would also rewrite quotes,
// which Slack would then show literally.
const SLACK_ESCAPES: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
}

// Google Chat parses <users/all> and <url|text> too, but documents no entity
// escaping, so &lt; could appear literally. A word joiner after each < keeps
// the text looking the same while breaking the syntax.
const WORD_JOINER = '\u2060'

function neutralise(text: string, kind: WebhookKind): string {
    if (kind === 'slack') {
        return text.replace(/[&<>]/g, char => SLACK_ESCAPES[char]!)
    }
    return text.replaceAll('<', `<${WORD_JOINER}`)
}

function convertLine(line: string): string {
    const heading = line.match(/^#{1,6}\s+(.*)$/)
    if (heading) return `*${heading[1]}*`
    return line.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '*$1*')
}

export function toChatText(markdown: string, kind: WebhookKind): string {
    if (MARKDOWN_NATIVE.includes(kind)) return markdown

    let fenced = false
    return neutralise(markdown, kind)
        .split('\n')
        .map(line => {
            if (FENCE.test(line)) {
                fenced = !fenced
                return line
            }
            return fenced ? line : convertLine(line)
        })
        .join('\n')
}
