import { describe, expect, it } from 'bun:test'

import type { FetchLike } from '../standup.types'
import { GitLabProvider } from './gitlab'

const TODAY = new Date('2026-08-28T00:00:00Z')

function routedFetch(routes: Record<string, unknown>): FetchLike {
    return async (url: string) => {
        for (const [needle, payload] of Object.entries(routes)) {
            if (url.includes(needle)) {
                return new Response(JSON.stringify(payload), { status: 200 })
            }
        }
        return new Response('[]', { status: 200 })
    }
}

describe('getIdentity', () => {
    it('returns id and username', async () => {
        const gl = new GitLabProvider(
            'h',
            't',
            routedFetch({ '/user': { id: 285, username: 'dev', name: 'Dev' } })
        )
        await expect(gl.getIdentity()).resolves.toEqual({ id: 285, username: 'dev' })
    })

    it('throws a descriptive error when the api is unreachable', async () => {
        const gl = new GitLabProvider('gitlab.example.com', 't', async () => {
            throw new Error('offline')
        })
        await expect(gl.getIdentity()).rejects.toThrow(/gitlab\.example\.com/)
    })
})

describe('getEvents', () => {
    it('shapes rows and resolves project paths', async () => {
        const gl = new GitLabProvider(
            'h',
            't',
            routedFetch({
                '/events': [
                    {
                        created_at: '2026-08-27T10:57:00.000+03:00',
                        action_name: 'pushed to',
                        project_id: 12,
                        target_type: 'Project',
                        target_title: 'Web',
                        push_data: {
                            ref: 'fix/date-range',
                            commit_count: 2,
                            commit_title: 'fix(filter): send both dates',
                        },
                    },
                ],
                '/projects/12': { path_with_namespace: 'acme/web' },
            })
        )

        const rows = await gl.getEvents(new Date('2026-08-20T00:00:00Z'))
        expect(rows).toHaveLength(1)
        expect(rows[0]).toMatchObject({
            at: '2026-08-27T10:57',
            project: 'acme/web',
            branch: 'fix/date-range',
            commits: 2,
        })
    })

    it('tolerates events with no push data', async () => {
        const gl = new GitLabProvider(
            'h',
            't',
            routedFetch({
                '/events': [
                    {
                        created_at: '2026-08-27T11:02:00.000+03:00',
                        action_name: 'opened',
                        project_id: 12,
                        target_type: 'MergeRequest',
                        target_title: 'fix: skip empty chip row',
                    },
                ],
                '/projects/12': { path_with_namespace: 'acme/web' },
            })
        )

        const [row] = await gl.getEvents(new Date('2026-08-20T00:00:00Z'))
        expect(row).toMatchObject({
            branch: '',
            commits: 0,
            title: 'fix: skip empty chip row',
        })
    })
})

describe('getMyMrs', () => {
    it('assigns buckets and flags a missing pipeline', async () => {
        const gl = new GitLabProvider(
            'h',
            't',
            routedFetch({
                'scope=created_by_me': [
                    {
                        project_id: 1, iid: 7, title: 'refactor: loading state',
                        draft: false, source_branch: 'refactor/loading',
                        target_branch: 'main', updated_at: '2026-08-26T00:00:00Z',
                        web_url: 'https://h/acme/web/-/merge_requests/7',
                        references: { full: 'acme/web!7' },
                        detailed_merge_status: 'mergeable',
                    },
                    {
                        project_id: 1, iid: 6, title: 'ci: release pipeline',
                        draft: true, source_branch: 'ci/release',
                        target_branch: 'main', updated_at: '2026-08-25T00:00:00Z',
                        web_url: 'https://h/acme/web/-/merge_requests/6',
                        references: { full: 'acme/web!6' },
                        detailed_merge_status: 'draft_status',
                    },
                ],
                'merge_requests/7/pipelines': [],
                'merge_requests/6/pipelines': [{ id: 99, status: 'failed' }],
                discussions: [],
            })
        )

        const rows = await gl.getMyMrs(TODAY)
        const byIid = Object.fromEntries(rows.map((r) => [r.iid, r]))

        expect(byIid[6]!.bucket).toBe('draft')
        expect(byIid[7]!.bucket).toBe('ready')
        expect(byIid[7]!.pipeline).toBeNull()
        expect(byIid[7]!.pipelineMissing).toBe(true)
    })

    it('counts unresolved discussions', async () => {
        const gl = new GitLabProvider(
            'h',
            't',
            routedFetch({
                'scope=created_by_me': [
                    {
                        project_id: 1, iid: 49, title: 'fix: drop chips',
                        draft: false, source_branch: 'fix/chips',
                        target_branch: 'main', updated_at: '2026-08-27T00:00:00Z',
                        web_url: 'https://h/acme/web/-/merge_requests/49',
                        references: { full: 'acme/web!49' },
                        detailed_merge_status: 'unchecked',
                    },
                ],
                pipelines: [{ id: 5, status: 'success' }],
                discussions: [
                    { notes: [{ system: false, resolvable: true, resolved: false }] },
                    { notes: [{ system: false, resolvable: true, resolved: true }] },
                    { notes: [{ system: true, resolvable: false }] },
                ],
            })
        )

        const [row] = await gl.getMyMrs(TODAY)
        expect(row!.unresolved).toBe(1)
        expect(row!.bucket).toBe('blocked')
    })
})

describe('getReviews', () => {
    it('marks merge requests I already approved', async () => {
        const gl = new GitLabProvider(
            'h',
            't',
            routedFetch({
                reviewer_id: [
                    {
                        project_id: 1, iid: 53, title: 'feat: refund limits',
                        draft: false, updated_at: '2026-08-27T00:00:00Z',
                        author: { name: 'Teammate' },
                        web_url: 'https://h/acme/web/-/merge_requests/53',
                        references: { full: 'acme/web!53' },
                    },
                ],
                approvals: { approved_by: [{ user: { id: 285 } }] },
            })
        )

        const [row] = await gl.getReviews(285, TODAY)
        expect(row).toMatchObject({ approvedByMe: true, author: 'Teammate', fresh: true })
    })

    it('leaves unapproved merge requests pending', async () => {
        const gl = new GitLabProvider(
            'h',
            't',
            routedFetch({
                reviewer_id: [
                    {
                        project_id: 1, iid: 54, title: 'feat: balance inquiry',
                        draft: false, updated_at: '2026-08-28T00:00:00Z',
                        author: { name: 'Teammate' },
                        web_url: 'https://h/acme/web/-/merge_requests/54',
                        references: { full: 'acme/web!54' },
                    },
                ],
                approvals: { approved_by: [] },
            })
        )

        const [row] = await gl.getReviews(285, TODAY)
        expect(row!.approvedByMe).toBe(false)
    })

    it('measures freshness against the given today, not the wall clock', async () => {
        const longAgo = new Date('2020-01-15T00:00:00Z')
        const gl = new GitLabProvider(
            'h',
            't',
            routedFetch({
                reviewer_id: [
                    {
                        project_id: 1, iid: 12, title: 'chore: recent back then',
                        draft: false, updated_at: '2020-01-14T00:00:00Z',
                        author: { name: 'Teammate' },
                        web_url: 'https://h/acme/web/-/merge_requests/12',
                        references: { full: 'acme/web!12' },
                    },
                ],
                approvals: { approved_by: [] },
            })
        )

        const [row] = await gl.getReviews(285, longAgo)
        expect(row!.fresh).toBe(true)
    })
})
