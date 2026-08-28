import { describe, expect, it } from 'bun:test'

import { approvedBy, countChangesRequested, normalizeChecks } from './github.state'
import type { CheckRun, PullReview } from './github.types'

function check(overrides: Partial<CheckRun> = {}): CheckRun {
    return {
        id: 1,
        name: 'build',
        status: 'completed',
        conclusion: 'success',
        ...overrides,
    }
}

function review(login: string, state: string): PullReview {
    return { state, user: { login } }
}

describe('normalizeChecks', () => {
    it('reports no pipeline when there are no check runs', () => {
        expect(normalizeChecks([])).toEqual({ pipeline: null, pipelineId: null })
    })

    it('reports failed and keeps the failing check id', () => {
        const runs = [check(), check({ id: 42, conclusion: 'failure' })]
        expect(normalizeChecks(runs)).toEqual({ pipeline: 'failed', pipelineId: 42 })
    })

    it('treats a timeout as failed', () => {
        expect(normalizeChecks([check({ conclusion: 'timed_out' })]).pipeline).toBe('failed')
    })

    it('treats a startup failure as failed', () => {
        expect(normalizeChecks([check({ conclusion: 'startup_failure' })]).pipeline).toBe(
            'failed'
        )
    })

    it('treats a required manual step as failed, because it blocks the merge', () => {
        expect(normalizeChecks([check({ conclusion: 'action_required' })]).pipeline).toBe(
            'failed'
        )
    })

    it('reports running while any check is still going', () => {
        const runs = [check(), check({ id: 2, status: 'in_progress', conclusion: null })]
        expect(normalizeChecks(runs)).toEqual({ pipeline: 'running', pipelineId: null })
    })

    it('prefers failed over running', () => {
        const runs = [
            check({ id: 2, status: 'in_progress', conclusion: null }),
            check({ id: 3, conclusion: 'failure' }),
        ]
        expect(normalizeChecks(runs).pipeline).toBe('failed')
    })

    it('reports canceled when nothing failed but something was cancelled', () => {
        const runs = [check(), check({ id: 2, conclusion: 'cancelled' })]
        expect(normalizeChecks(runs)).toEqual({ pipeline: 'canceled', pipelineId: null })
    })

    it('reports success when everything passed, was neutral or was skipped', () => {
        const runs = [
            check(),
            check({ id: 2, conclusion: 'neutral' }),
            check({ id: 3, conclusion: 'skipped' }),
        ]
        expect(normalizeChecks(runs)).toEqual({ pipeline: 'success', pipelineId: null })
    })
})

describe('countChangesRequested', () => {
    it('counts one reviewer who asked for changes', () => {
        expect(countChangesRequested([review('a', 'CHANGES_REQUESTED')])).toBe(1)
    })

    it('uses only the latest review from each reviewer', () => {
        const reviews = [review('a', 'CHANGES_REQUESTED'), review('a', 'APPROVED')]
        expect(countChangesRequested(reviews)).toBe(0)
    })

    it('ignores plain comments, which do not change the state on github', () => {
        const reviews = [review('a', 'CHANGES_REQUESTED'), review('a', 'COMMENTED')]
        expect(countChangesRequested(reviews)).toBe(1)
    })

    it('ignores a pending draft review', () => {
        expect(countChangesRequested([review('a', 'PENDING')])).toBe(0)
    })

    it('counts distinct reviewers separately', () => {
        const reviews = [review('a', 'CHANGES_REQUESTED'), review('b', 'CHANGES_REQUESTED')]
        expect(countChangesRequested(reviews)).toBe(2)
    })

    it('skips reviews with no author', () => {
        expect(countChangesRequested([{ state: 'CHANGES_REQUESTED' }])).toBe(0)
    })
})

describe('approvedBy', () => {
    it('is true when my latest review is an approval', () => {
        expect(approvedBy([review('me', 'APPROVED')], 'me')).toBe(true)
    })

    it('is false once I have asked for changes since', () => {
        const reviews = [review('me', 'APPROVED'), review('me', 'CHANGES_REQUESTED')]
        expect(approvedBy(reviews, 'me')).toBe(false)
    })

    it('is false when somebody else approved', () => {
        expect(approvedBy([review('other', 'APPROVED')], 'me')).toBe(false)
    })
})
