import { localAt } from '../../dates/dates'
import { EVENT_ACTIONS, EVENT_TARGET_TYPES } from './github.constants'
import type { ActivityEvent } from '../../types/standup.types'
import type { RawEvent } from './github.types'

export function repoFromUrl(repositoryUrl: string): string {
    const match = /\/repos\/([^/]+\/[^/]+)/.exec(repositoryUrl)
    return match ? match[1]! : ''
}

export function mapEvent(raw: RawEvent): ActivityEvent {
    const payload = raw.payload ?? {}
    const type = raw.type ?? ''
    const commits = payload.commits ?? []
    const last = commits[commits.length - 1]

    return {
        at: localAt(raw.created_at),
        action:
            type === 'PullRequestEvent'
                ? String(payload.action ?? 'updated')
                : (EVENT_ACTIONS[type] ??
                  type.replace(/Event$/, '').toLowerCase()),
        project: raw.repo?.name ?? '',
        targetType: EVENT_TARGET_TYPES[type] ?? '',
        title: payload.pull_request?.title ?? payload.issue?.title ?? '',
        branch: String(payload.ref ?? '').replace(/^refs\/heads\//, ''),
        commits: Number(payload.size ?? 0),
        commitTitle: last ? String(last.message ?? '').split('\n')[0]! : '',
    }
}
