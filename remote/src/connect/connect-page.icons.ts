import { siClaude, siGithub, siGitlab } from 'simple-icons'
import type { SimpleIcon } from 'simple-icons'

import type { ProviderKind } from '../../../src/types/standup.types'

function brand(icon: SimpleIcon, className = ''): string {
    return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${icon.path}"/></svg>`
}

export const PROVIDER_ICONS: Record<ProviderKind, string> = {
    github: brand(siGithub, 'mark'),
    gitlab: brand(siGitlab, 'mark mark-gitlab'),
}

export const CLAUDE_ICON = brand(siClaude, 'mark mark-claude')

export const CHECK_ICON =
    '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M5 10.5l3.2 3.2L15 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'

export const CROSS_ICON =
    '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M6.5 6.5l7 7m0-7l-7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'

export const LOCK_ICON =
    '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><rect x="4.5" y="9" width="11" height="8" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M7 9V6.8a3 3 0 016 0V9" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>'

// The connector between the two apps is the project icon's own shape: a
// straight branch, and a red one that leaves it and merges at a dot.
export const MERGE_LINE = `<svg class="merge" viewBox="0 0 120 56" aria-hidden="true" focusable="false">
    <path class="merge-base" d="M2 38H118"/>
    <path class="merge-branch" pathLength="1" d="M2 38H34C52 38 52 16 70 16H106"/>
    <circle class="merge-dot" cx="108" cy="16" r="5"/>
</svg>`
