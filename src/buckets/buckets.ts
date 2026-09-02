import { STALE_DAYS } from './buckets.constants'
import type { BucketInput, PipelineInput } from './buckets.types'
import { isoDay } from '../dates/dates'
import { MS_PER_DAY } from '../dates/dates.constants'
import type { Bucket } from '../types/standup.types'

export function classify(
    mr: BucketInput,
    today: Date,
    staleDays = STALE_DAYS
): Bucket {
    if (mr.draft) return 'draft'
    if (
        mr.pipeline === 'failed' ||
        mr.pipeline === 'canceled' ||
        mr.unresolved > 0
    )
        return 'blocked'

    const age = Math.round(
        (Date.parse(`${isoDay(today)}T00:00:00Z`) -
            Date.parse(`${mr.updated}T00:00:00Z`)) /
            MS_PER_DAY
    )
    return age >= staleDays ? 'stale' : 'ready'
}

export function markMissingPipelines(mrs: PipelineInput[]): void {
    const withCi = new Set(mrs.filter(mr => mr.pipeline).map(mr => mr.project))
    for (const mr of mrs) {
        mr.pipelineMissing = mr.pipeline === null && withCi.has(mr.project)
    }
}
