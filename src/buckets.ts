/** Sort open merge requests into the four states a standup cares about. */

import type { Bucket } from './types'

export const STALE_DAYS = 14

const MS_PER_DAY = 86_400_000

export interface BucketInput {
    draft: boolean
    pipeline: string | null
    unresolved: number
    updated: string
}

export interface PipelineInput {
    project: string
    pipeline: string | null
    pipelineMissing?: boolean
}

/** Return the bucket one merge request belongs in. */
export function classify(mr: BucketInput, today: Date, staleDays = STALE_DAYS): Bucket {
    if (mr.draft) return 'draft'
    if (mr.pipeline === 'failed' || mr.unresolved > 0) return 'blocked'

    const age = Math.round(
        (Date.parse(`${today.toISOString().slice(0, 10)}T00:00:00Z`) -
            Date.parse(`${mr.updated}T00:00:00Z`)) /
            MS_PER_DAY
    )
    return age >= staleDays ? 'stale' : 'ready'
}

/**
 * Set `pipelineMissing` on each merge request, in place.
 *
 * True only when this merge request has no pipeline *and* another merge request
 * in the same project does — that combination means CI exists but never ran
 * here, which must not be read as "green". A project with no CI at all is never
 * flagged.
 */
export function markMissingPipelines(mrs: PipelineInput[]): void {
    const withCi = new Set(mrs.filter((mr) => mr.pipeline).map((mr) => mr.project))
    for (const mr of mrs) {
        mr.pipelineMissing = mr.pipeline === null && withCi.has(mr.project)
    }
}
