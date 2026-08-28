/**
 * The contract every forge provider must satisfy.
 *
 * Only GitLab is implemented. The boundary exists so a GitHub provider can be
 * added without restructuring the core — drawing it now is free, retrofitting
 * it later is not.
 */

import type { ActivityEvent, Blocker, Identity, MergeRequest, Review } from '../types'

export interface Provider {
    /** The authenticated user. */
    getIdentity(): Promise<Identity>
    /** Activity events on or after `since`. */
    getEvents(since: Date): Promise<ActivityEvent[]>
    /** Open merge requests authored by the authenticated user, bucketed against `today`. */
    getMyMrs(today: Date): Promise<MergeRequest[]>
    /** Open merge requests awaiting review from `uid`, freshness measured against `today`. */
    getReviews(uid: number, today: Date): Promise<Review[]>
    /** Failure detail for merge requests with red pipelines. */
    getBlockers(mrs: MergeRequest[]): Promise<Blocker[]>
}
