import { describe, expect, it } from 'bun:test'

import { toMarkdown } from './render'
import type { StandupReport } from './standup.types'

const REPORT = {
    user: 'dev',
    today: { date: '2026-08-28', label: 'Friday, 28 August' },
    previous: {
        date: '2026-08-27',
        label: 'Thursday, 27 August',
        gapDays: 1,
        eventCount: 2,
    },
    previousEvents: [
        {
            at: '2026-08-27T10:57', action: 'pushed to', project: 'acme/web',
            targetType: 'Project', title: '', branch: 'fix/date-range',
            commits: 2, commitTitle: 'fix(filter): send both dates',
        },
        {
            at: '2026-08-27T11:02', action: 'opened', project: 'acme/ui',
            targetType: 'MergeRequest', title: 'fix: skip empty chip row',
            branch: '', commits: 0, commitTitle: '',
        },
    ],
    todayEvents: [],
    myMrs: [
        {
            project: 'acme/web', projectId: 1, iid: 7, title: 'refactor: loading state',
            draft: false, branch: 'x', target: 'main', updated: '2026-08-26',
            url: 'u', mergeStatus: 'mergeable', pipeline: null, pipelineId: null,
            unresolved: 0, pipelineMissing: true, bucket: 'ready' as const,
        },
        {
            project: 'acme/web', projectId: 1, iid: 49, title: 'fix: drop chips',
            draft: false, branch: 'y', target: 'main', updated: '2026-08-27',
            url: 'u', mergeStatus: 'unchecked', pipeline: 'success', pipelineId: 5,
            unresolved: 1, pipelineMissing: false, bucket: 'blocked' as const,
        },
    ],
    reviews: [
        {
            project: 'acme/web', iid: 54, title: 'feat: balance inquiry',
            author: 'Teammate', updated: '2026-08-28', draft: false, url: 'u',
            fresh: true, approvedByMe: false,
        },
        {
            project: 'acme/web', iid: 53, title: 'feat: refund limits',
            author: 'Teammate', updated: '2026-08-27', draft: false, url: 'u',
            fresh: true, approvedByMe: true,
        },
    ],
    reviewPendingCount: 1,
    blockers: [
        {
            project: 'acme/mobile', mr: 6, title: 'ci: release pipeline',
            job: 'quality', stage: 'quality', url: 'https://h/x',
            errors: ['error: GET .../@acme/ui-1.2.0.tgz - 404'],
        },
    ],
} satisfies StandupReport

describe('toMarkdown', () => {
    it('includes both day labels', () => {
        const out = toMarkdown(REPORT)
        expect(out).toContain('Thursday, 27 August')
        expect(out).toContain('Friday, 28 August')
    })

    it('states that it is a digest, not a written note', () => {
        expect(toMarkdown(REPORT).toLowerCase()).toContain('digest')
    })

    it('flags a merge request with no pipeline', () => {
        expect(toMarkdown(REPORT).toLowerCase()).toContain('no pipeline')
    })

    it('shows the pending review count, not the raw total', () => {
        const out = toMarkdown(REPORT)
        expect(out).toContain('1 pending')
        expect(out).toContain('feat: balance inquiry')
        expect(out).not.toContain('feat: refund limits')
    })

    it('renders blocker error lines', () => {
        expect(toMarkdown(REPORT)).toContain('404')
    })

    it('omits the blocker section when there are none', () => {
        expect(toMarkdown({ ...REPORT, blockers: [] })).not.toContain('Blockers')
    })

    it('renders Turkish headings', () => {
        expect(toMarkdown(REPORT, 'tr')).toContain('Önceki')
    })

    it('renders every populated bucket, in order', () => {
        const ready = REPORT.myMrs[0]!
        const blocked = REPORT.myMrs[1]!
        const all = {
            ...REPORT,
            myMrs: [
                { ...ready, iid: 1, bucket: 'stale' as const, pipelineMissing: false },
                { ...ready, iid: 2, bucket: 'draft' as const, pipelineMissing: false },
                { ...blocked, iid: 3, bucket: 'blocked' as const },
                { ...ready, iid: 4, bucket: 'ready' as const, pipelineMissing: false },
            ],
        }

        const out = toMarkdown(all)
        const positions = ['## Ready to merge', '## Blocked', '## Drafts', '## Stale'].map((h) =>
            out.indexOf(h)
        )

        expect(positions.every((i) => i >= 0)).toBe(true)
        expect(positions).toEqual([...positions].sort((a, b) => a - b))
    })
})
