import { describe, expect, it } from 'bun:test'

import type {
    ActivityEvent,
    Bucket,
    MergeRequest,
    StandupReport,
} from '../types/standup.types'

import { toChatDigest } from './digest'

const PANEL = 'superapp/box-office-panel'
const DEPOSIT_PUSH =
    'feat(create-user): enable predefined deposit in anonymous flow'

function event(overrides: Partial<ActivityEvent>): ActivityEvent {
    return {
        action: 'pushed to',
        at: '2026-10-09T10:00',
        branch: '',
        commits: 0,
        commitTitle: '',
        project: PANEL,
        targetType: '',
        title: '',
        ...overrides,
    }
}

function mr(
    project: string,
    iid: number,
    bucket: Bucket,
    overrides: Partial<MergeRequest> = {}
): MergeRequest {
    return {
        branch: `feat/${iid}`,
        bucket,
        draft: bucket === 'draft',
        iid,
        mergeStatus: null,
        pipeline: 'success',
        pipelineId: null,
        pipelineMissing: false,
        project,
        projectId: iid,
        provider: 'gitlab',
        target: 'main',
        title: `MR ${iid}`,
        unresolved: 0,
        updated: '2026-10-09T10:00',
        url: `https://git.example.com/${project}/-/merge_requests/${iid}`,
        ...overrides,
    }
}

const pushes = Array.from({ length: 40 }, (_, i) =>
    event({
        at: `2026-10-09T${String(9 + Math.floor(i / 6)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}`,
        branch: 'feat/predefined-deposit',
        commits: 1,
        commitTitle: DEPOSIT_PUSH,
    })
)

const REPORT: StandupReport = {
    provider: 'gitlab',
    user: 'ilker.balcilar',
    today: { date: '2026-10-12', label: 'Monday, 12 October' },
    previousDays: [
        {
            date: '2026-10-09',
            gapDays: 3,
            label: 'Friday, 9 October',
            events: [
                ...pushes,
                event({
                    action: 'pushed to',
                    branch: 'main',
                    commits: 1,
                    commitTitle:
                        "Merge branch 'feat/predefined-deposit' into 'main'",
                }),
                event({
                    action: 'deleted',
                    branch: 'feat/old',
                    title: 'SuperApp - Box Office Panel',
                }),
                event({
                    action: 'pushed new',
                    branch: 'release',
                    commits: 1,
                    commitTitle: 'SuperApp - Box Office Panel',
                }),
                event({
                    action: 'opened',
                    targetType: 'MergeRequest',
                    title: 'feat(create-user): add predefined deposit to anonymous flow',
                }),
                event({
                    action: 'commented on',
                    targetType: 'MergeRequest',
                    title: 'feat(create-user): add predefined deposit to anonymous flow',
                }),
                event({
                    action: 'accepted',
                    targetType: 'MergeRequest',
                    title: 'feat(create-user): add predefined deposit to anonymous flow',
                }),
                event({
                    action: 'pushed to',
                    branch: 'feat/pos-receipts',
                    commits: 2,
                    commitTitle: 'wip',
                }),
                event({
                    action: 'pushed to',
                    branch: 'feat/pos-receipts',
                    commits: 1,
                    commitTitle: 'more wip',
                }),
            ],
        },
    ],
    todayEvents: [
        event({
            at: '2026-10-12T09:00',
            commits: 1,
            commitTitle: 'today push',
            branch: 'x',
        }),
    ],
    myMrs: [
        mr('altpay/superface', 4, 'ready'),
        mr('altpay/superface', 3, 'ready'),
        mr('altpay/superface', 2, 'ready'),
        mr('altpay/superface', 1, 'ready'),
        mr('altpay/superui', 114, 'ready'),
        mr(PANEL, 205, 'ready', {
            branch: 'feat/pos-receipts',
            title: 'feat(pos-receipts): render raw response with json viewer',
        }),
        mr('altpay/joyport-mobile', 6, 'blocked', { pipeline: 'failed' }),
        ...[10, 11, 12, 13].map(iid => mr(PANEL, iid, 'draft')),
        ...[20, 21, 22, 23, 24].map(iid => mr(PANEL, iid, 'stale')),
    ],
    blockers: [
        {
            errors: [
                'GET https://registry.example.com/@altpay/joyport-1.0.1.tgz - 404',
                'npm ERR! second line',
            ],
            job: 'quality',
            mr: 6,
            project: 'altpay/joyport-mobile',
            provider: 'gitlab',
            stage: 'test',
            title: 'MR 6',
            url: 'https://git.example.com/altpay/joyport-mobile/-/jobs/1',
        },
    ],
    reviewPendingCount: 9,
    reviews: [],
}

describe('toChatDigest', () => {
    const digest = toChatDigest(REPORT)
    const lines = digest.trimEnd().split('\n')

    it('fits a chat message', () => {
        expect(lines.length).toBeLessThanOrEqual(20)
        expect(lines[0]).toBe(
            '**Standup — Monday, 12 October** · ilker.balcilar'
        )
    })

    it('collapses repeated pushes and events for one title', () => {
        expect(digest.split(DEPOSIT_PUSH)).toHaveLength(2)
        expect(digest).toContain(
            '- box-office-panel — feat(create-user): add predefined deposit to anonymous flow (merged)'
        )
        expect(digest).toContain(
            '- box-office-panel — feat(pos-receipts): render raw response with json viewer'
        )
        expect(digest).not.toContain('pushed to')
    })

    it('drops project-name and merge-commit noise and today events', () => {
        expect(digest).not.toContain('SuperApp - Box Office Panel')
        expect(digest).not.toContain('Merge branch')
        expect(digest).not.toContain('today push')
    })

    it('summarises ready, blocked and the rest', () => {
        expect(digest).toContain(
            '**Ready to merge (6)** superface !4, !3, !2, !1 · superui !114 · box-office-panel !205'
        )
        expect(digest).toContain(
            '- joyport-mobile !6 — pipeline failed (quality): `GET https://registry.example.com/@altpay/joyport-1.0.1.tgz - 404`'
        )
        expect(digest).toContain(
            '**Also:** 4 drafts · 5 stale · 9 reviews waiting'
        )
    })

    it('says how long ago an older active day was', () => {
        const older = toChatDigest({
            ...REPORT,
            previousDays: [
                {
                    ...REPORT.previousDays[0]!,
                    date: '2026-10-07',
                    gapDays: 5,
                    label: 'Wednesday, 7 October',
                },
            ],
        })
        expect(older).toContain('**Wednesday, 7 October (5 days ago)**')
    })

    it('omits empty sections', () => {
        const quiet = toChatDigest({
            ...REPORT,
            previousDays: [],
            myMrs: [],
            blockers: [],
            reviewPendingCount: 0,
        })
        expect(quiet).toBe(
            '**Standup — Monday, 12 October** · ilker.balcilar\n'
        )
    })
})
