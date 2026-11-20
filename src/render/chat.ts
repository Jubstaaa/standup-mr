import type { WebhookKind } from '../notify/notify.types'

const MARKDOWN_NATIVE: readonly WebhookKind[] = ['discord']

const FENCE = /^```/

// Slack and Google Chat read <...> as control sequences (<!channel>, <@U1>,
// links), so a merge request title could ping a whole channel. Their docs
// name exactly these three characters; an HTML escaper would also rewrite
// quotes, which the chat clients would then show literally.
const CONTROL_CHARACTERS: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
}

function escapeControl(text: string): string {
    return text.replace(/[&<>]/g, char => CONTROL_CHARACTERS[char]!)
}

function convertLine(line: string): string {
    const heading = line.match(/^#{1,6}\s+(.*)$/)
    if (heading) return `*${heading[1]}*`
    return line.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '*$1*')
}

export function toChatText(markdown: string, kind: WebhookKind): string {
    if (MARKDOWN_NATIVE.includes(kind)) return markdown

    let fenced = false
    return escapeControl(markdown)
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
