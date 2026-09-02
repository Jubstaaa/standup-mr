import { describe, expect, it } from 'bun:test'

import { mapEvent, repoFromUrl } from './github.map'
import type { RawEvent } from './github.types'

describe('repoFromUrl', () => {
    it('pulls owner and repo out of an api url', () => {
        expect(repoFromUrl('https://api.github.com/repos/acme/web')).toBe(
            'acme/web'
        )
    })

    it('works for a github enterprise url', () => {
        expect(repoFromUrl('https://git.acme.com/api/v3/repos/acme/web')).toBe(
            'acme/web'
        )
    })

    it('returns an empty string when the url has no repo', () => {
        expect(repoFromUrl('https://api.github.com/user')).toBe('')
    })
})

describe('mapEvent', () => {
    it('reports the true commit count, not the truncated commit list', () => {
        const raw: RawEvent = {
            type: 'PushEvent',
            created_at: '2026-08-27T10:57:00Z',
            repo: { name: 'acme/web' },
            payload: {
                ref: 'refs/heads/fix/date-range',
                size: 34,
                commits: [
                    { message: 'fix(filter): send both dates' },
                    { message: 'chore: tidy up\n\nlonger body' },
                ],
            },
        }

        expect(mapEvent(raw)).toMatchObject({
            action: 'pushed to',
            project: 'acme/web',
            branch: 'fix/date-range',
            commits: 34,
            commitTitle: 'chore: tidy up',
        })
    })

    it('uses the pull request action verb and the merge request target type', () => {
        const raw: RawEvent = {
            type: 'PullRequestEvent',
            created_at: '2026-08-27T11:00:00Z',
            repo: { name: 'acme/api' },
            payload: {
                action: 'opened',
                pull_request: { title: 'feat: add stories endpoint' },
            },
        }

        expect(mapEvent(raw)).toMatchObject({
            action: 'opened',
            targetType: 'MergeRequest',
            title: 'feat: add stories endpoint',
            commits: 0,
            commitTitle: '',
        })
    })

    it('maps review and comment events onto one verb', () => {
        const review: RawEvent = {
            type: 'PullRequestReviewEvent',
            created_at: '2026-08-27T12:00:00Z',
            repo: { name: 'acme/api' },
            payload: { pull_request: { title: 'fix: token expiry' } },
        }
        const comment: RawEvent = {
            type: 'IssueCommentEvent',
            created_at: '2026-08-27T12:30:00Z',
            repo: { name: 'acme/api' },
            payload: { issue: { title: 'flaky test' } },
        }

        expect(mapEvent(review).action).toBe('reviewed')
        expect(mapEvent(comment)).toMatchObject({
            action: 'commented on',
            targetType: 'Note',
        })
    })

    it('strips the refs/heads prefix and names branch creation', () => {
        const raw: RawEvent = {
            type: 'CreateEvent',
            created_at: '2026-08-27T13:00:00Z',
            repo: { name: 'acme/web' },
            payload: { ref: 'release/0.2.0' },
        }

        expect(mapEvent(raw)).toMatchObject({
            action: 'created',
            branch: 'release/0.2.0',
        })
    })

    it('falls back to a readable verb for an unknown event type', () => {
        const raw: RawEvent = {
            type: 'ReleaseEvent',
            created_at: '2026-08-27T14:00:00Z',
            repo: { name: 'acme/web' },
        }

        expect(mapEvent(raw).action).toBe('release')
    })

    it('survives a payload with nothing in it', () => {
        const raw: RawEvent = {
            type: 'PushEvent',
            created_at: '2026-08-27T15:00:00Z',
        }

        expect(mapEvent(raw)).toMatchObject({
            project: '',
            branch: '',
            commits: 0,
            commitTitle: '',
            title: '',
        })
    })
})
