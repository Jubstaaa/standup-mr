import type { WebhookKind } from '../notify/notify.types'

const MARKDOWN_NATIVE: readonly WebhookKind[] = ['discord']

const FENCE = /^```/

function convertLine(line: string): string {
    const heading = line.match(/^#{1,6}\s+(.*)$/)
    if (heading) return `*${heading[1]}*`
    return line.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '*$1*')
}

export function toChatText(markdown: string, kind: WebhookKind): string {
    if (MARKDOWN_NATIVE.includes(kind)) return markdown

    let fenced = false
    return markdown
        .split('\n')
        .map((line) => {
            if (FENCE.test(line)) {
                fenced = !fenced
                return line
            }
            return fenced ? line : convertLine(line)
        })
        .join('\n')
}
