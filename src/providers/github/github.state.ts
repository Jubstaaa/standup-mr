import { FAILED_CONCLUSIONS } from './github.constants'
import type { CheckRun, PullReview } from './github.types'

export function normalizeChecks(runs: CheckRun[]): {
    pipeline: string | null
    pipelineId: number | null
} {
    if (runs.length === 0) return { pipeline: null, pipelineId: null }

    const failed = runs.find(
        (run) => run.conclusion !== null && FAILED_CONCLUSIONS.has(run.conclusion)
    )
    if (failed) return { pipeline: 'failed', pipelineId: failed.id }

    if (runs.some((run) => run.status !== 'completed')) {
        return { pipeline: 'running', pipelineId: null }
    }
    if (runs.some((run) => run.conclusion === 'cancelled')) {
        return { pipeline: 'canceled', pipelineId: null }
    }
    return { pipeline: 'success', pipelineId: null }
}

export function latestStateByReviewer(reviews: PullReview[]): Map<string, string> {
    const latest = new Map<string, string>()
    for (const review of reviews) {
        const login = review.user?.login
        if (!login) continue
        if (review.state === 'COMMENTED' || review.state === 'PENDING') continue
        latest.set(login, review.state)
    }
    return latest
}

export function countChangesRequested(reviews: PullReview[]): number {
    return [...latestStateByReviewer(reviews).values()].filter(
        (state) => state === 'CHANGES_REQUESTED'
    ).length
}

export function approvedBy(reviews: PullReview[], login: string): boolean {
    return latestStateByReviewer(reviews).get(login) === 'APPROVED'
}
