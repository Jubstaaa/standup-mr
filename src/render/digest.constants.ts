export const MAX_DAY_LINES = 8
export const TITLE_LIMIT = 80
export const ERROR_LIMIT = 120

export const MERGED_ACTIONS: readonly string[] = ['accepted', 'merged']
export const MERGE_COMMIT =
    /^Merge (branch|remote-tracking branch|pull request) /

export const DIGEST_STRINGS = {
    standup: 'Standup',
    yesterday: 'Yesterday',
    daysAgo: 'days ago',
    merged: 'merged',
    more: 'more',
    ready: 'Ready to merge',
    blocked: 'Blocked',
    pipelineFailed: 'pipeline failed',
    also: 'Also:',
    drafts: 'drafts',
    stale: 'stale',
    reviews: 'reviews waiting',
}
