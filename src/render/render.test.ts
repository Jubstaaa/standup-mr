import { describe, expect, it } from 'bun:test'

import type { StandupReport } from '../types/standup.types'

import { toMarkdown } from './render'

const REPORT = {
    provider: 'gitlab' as const,
    user: 'dev',
    today: { date: '2026-08-31', label: 'Monday, 31 August' },
    previousDays: [
        {
            date: '2026-08-28',
            label: 'Friday, 28 August',
            gapDays: 3,
            events: [
                {
                    at: '2026-08-28T10:57',
                    action: 'pushed to',
                    project: 'acme/web',
                    targetType: 'Project',
                    title: '',
                    branch: 'fix/date-range',
                    commits: 2,
                    commitTitle: 'fix(filter): send both dates',
                },
            ],
        },
        {
            date: '2026-08-29',
            label: 'Saturday, 29 August',
            gapDays: 2,
            events: [
                {
                    at: '2026-08-29T11:02',
                    action: 'opened',
                    project: 'acme/ui',
                    targetType: 'MergeRequest',
                    title: 'fix: skip empty chip row',
                    branch: '',
                    commits: 0,
                    commitTitle: '',
                },
            ],
        },
    ],
    todayEvents: [],
    myMrs: [
        {
            provider: 'gitlab' as const,
            project: 'acme/web',
            projectId: 1,
            iid: 7,
            title: 'refactor: loading state',
            draft: false,
            branch: 'x',
            target: 'main',
            updated: '2026-08-26',
            url: 'u',
            mergeStatus: 'mergeable',
            pipeline: null,
            pipelineId: null,
            unresolved: 0,
            pipelineMissing: true,
            bucket: 'ready' as const,
        },
        {
            provider: 'gitlab' as const,
            project: 'acme/web',
            projectId: 1,
            iid: 49,
            title: 'fix: drop chips',
            draft: false,
            branch: 'y',
            target: 'main',
            updated: '2026-08-27',
            url: 'u',
            mergeStatus: 'unchecked',
            pipeline: 'success',
            pipelineId: 5,
            unresolved: 1,
            pipelineMissing: false,
            bucket: 'blocked' as const,
        },
    ],
    reviews: [
        {
            provider: 'gitlab' as const,
            project: 'acme/web',
            iid: 54,
            title: 'feat: balance inquiry',
            author: 'Teammate',
            updated: '2026-08-28',
            draft: false,
            url: 'u',
            fresh: true,
            approvedByMe: false,
        },
        {
            provider: 'gitlab' as const,
            project: 'acme/web',
            iid: 53,
            title: 'feat: refund limits',
            author: 'Teammate',
            updated: '2026-08-27',
            draft: false,
            url: 'u',
            fresh: true,
            approvedByMe: true,
        },
    ],
    reviewPendingCount: 1,
    blockers: [
        {
            provider: 'gitlab' as const,
            project: 'acme/mobile',
            mr: 6,
            title: 'ci: release pipeline',
            job: 'quality',
            stage: 'quality',
            url: 'https://h/x',
            errors: ['error: GET .../@acme/ui-1.2.0.tgz - 404'],
        },
    ],
} satisfies StandupReport

describe('toMarkdown', () => {
    it("renders the top header with today's label and the user", () => {
        const out = toMarkdown(REPORT)
        expect(out).toContain('# Monday, 31 August — dev')
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
        expect(toMarkdown({ ...REPORT, blockers: [] })).not.toContain(
            'Blockers'
        )
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
                {
                    ...ready,
                    iid: 1,
                    bucket: 'stale' as const,
                    pipelineMissing: false,
                },
                {
                    ...ready,
                    iid: 2,
                    bucket: 'draft' as const,
                    pipelineMissing: false,
                },
                { ...blocked, iid: 3, bucket: 'blocked' as const },
                {
                    ...ready,
                    iid: 4,
                    bucket: 'ready' as const,
                    pipelineMissing: false,
                },
            ],
        }

        const out = toMarkdown(all)
        const positions = [
            '## Ready to merge',
            '## Blocked',
            '## Drafts',
            '## Stale',
        ].map(h => out.indexOf(h))

        expect(positions.every(i => i >= 0)).toBe(true)
        expect(positions).toEqual([...positions].sort((a, b) => a - b))
    })
})

describe('toMarkdown for github', () => {
    const GITHUB_REPORT = {
        ...REPORT,
        provider: 'github' as const,
        myMrs: REPORT.myMrs.map(mr => ({ ...mr, provider: 'github' as const })),
        reviews: REPORT.reviews.map(review => ({
            ...review,
            provider: 'github' as const,
        })),
        blockers: REPORT.blockers.map(blocker => ({
            ...blocker,
            provider: 'github' as const,
        })),
    } satisfies StandupReport

    it('uses the hash prefix for pull requests', () => {
        const out = toMarkdown(GITHUB_REPORT)
        expect(out).toContain('#49')
        expect(out).not.toContain('!49')
    })

    it('uses the hash prefix for reviews and blockers too', () => {
        const out = toMarkdown(GITHUB_REPORT)
        expect(out).toContain('#54')
        expect(out).toContain('#6')
    })

    it('calls the blocking comments a change request', () => {
        expect(toMarkdown(GITHUB_REPORT)).toContain('change request')
    })

    it('says it in Turkish too', () => {
        expect(toMarkdown(GITHUB_REPORT, 'tr')).toContain('değişiklik isteği')
    })

    it('keeps the bang prefix and the unresolved wording for gitlab', () => {
        const out = toMarkdown(REPORT)
        expect(out).toContain('!49')
        expect(out).toContain('unresolved comment')
    })
})

describe('toMarkdown across a weekend', () => {
    it('gives every active day its own section', () => {
        const out = toMarkdown(REPORT)
        expect(out).toContain('Friday, 28 August')
        expect(out).toContain('Saturday, 29 August')
    })

    it("keeps each day's events under that day", () => {
        const out = toMarkdown(REPORT)
        const friday = out.indexOf('Friday, 28 August')
        const saturday = out.indexOf('Saturday, 29 August')
        expect(out.indexOf('fix(filter): send both dates')).toBeGreaterThan(
            friday
        )
        expect(out.indexOf('fix(filter): send both dates')).toBeLessThan(
            saturday
        )
        expect(out.indexOf('skip empty chip row')).toBeGreaterThan(saturday)
    })
})
