export const PAGE_SIZE = 100
export const FRESH_REVIEW_DAYS = 7
export const API_VERSION = '2022-11-28'
export const DOT_COM = 'github.com'
export const SEARCH_CAP = 3

export const EVENT_FEED_CAP = 300
export const EVENTS_PAGE_CAP = EVENT_FEED_CAP / PAGE_SIZE

export const FAILED_CONCLUSIONS = new Set([
    'failure',
    'timed_out',
    'startup_failure',
    'action_required',
])

export const EVENT_ACTIONS: Record<string, string> = {
    PushEvent: 'pushed to',
    PullRequestReviewEvent: 'reviewed',
    PullRequestReviewCommentEvent: 'commented on',
    IssueCommentEvent: 'commented on',
    CreateEvent: 'created',
    DeleteEvent: 'deleted',
}

export const EVENT_TARGET_TYPES: Record<string, string> = {
    PullRequestEvent: 'MergeRequest',
    PullRequestReviewEvent: 'MergeRequest',
    PullRequestReviewCommentEvent: 'MergeRequest',
    IssueCommentEvent: 'Note',
}
