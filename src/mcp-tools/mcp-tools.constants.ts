export const STANDUP_TOOL_TITLE = 'Get standup data'
export const POST_TOOL_TITLE = 'Post standup note'
export const INSTRUCTIONS_TOOL_TITLE = 'Get note instructions'

export const INSTRUCTIONS_TOOL_DESCRIPTION =
    'Returns the note-writing rules — the playbook for turning get_standup_data output ' +
    'into a standup note a person would actually say out loud: how to group the previous ' +
    'day by theme, how to derive today from open merge requests, and how to report a ' +
    'blocker from its job log. Read-only, no arguments, no network. Call it once before ' +
    'writing the first note; the rules do not change between calls.'

export const STANDUP_PROMPT_TITLE = 'Write my standup'
export const STANDUP_PROMPT_DESCRIPTION =
    'Writes your standup note from merge request state: what you did, what is ' +
    'ready or blocked today, and why any pipeline is red.'

export const STANDUP_TOOL_ANNOTATIONS = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
}

export const POST_TOOL_ANNOTATIONS = {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
}

export const INSTRUCTIONS_TOOL_ANNOTATIONS = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
}

export const SERVER_ICONS = [
    {
        src: 'https://raw.githubusercontent.com/Jubstaaa/standup-mr/main/assets/icon-512.png',
        mimeType: 'image/png',
        sizes: ['512x512'],
    },
    {
        src: 'https://raw.githubusercontent.com/Jubstaaa/standup-mr/main/assets/icon.svg',
        mimeType: 'image/svg+xml',
        sizes: ['any'],
    },
]
