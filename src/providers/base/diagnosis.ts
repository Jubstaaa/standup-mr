import type { Blocker, MergeRequest } from '../../types/standup.types'

import { ApiError } from './http'

export const DIAGNOSIS_UNAVAILABLE = 'diagnosis unavailable'

const UNKNOWN = 'unknown'

export function degradable(cause: unknown): cause is ApiError {
    return cause instanceof ApiError && cause.status !== 401
}

export function undiagnosed(mr: MergeRequest, cause: ApiError): Blocker {
    return {
        provider: mr.provider,
        project: mr.project,
        mr: mr.iid,
        title: mr.title,
        job: UNKNOWN,
        stage: UNKNOWN,
        url: mr.url,
        errors: [`${DIAGNOSIS_UNAVAILABLE}: ${cause.message}`],
    }
}
