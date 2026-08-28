import type { ActivityEvent, Blocker, Identity, MergeRequest, Review } from '../../types/standup.types'

export interface Provider {
    getIdentity(): Promise<Identity>
    getEvents(since: Date): Promise<ActivityEvent[]>
    getMyMrs(today: Date): Promise<MergeRequest[]>
    getReviews(uid: number, today: Date): Promise<Review[]>
    getBlockers(mrs: MergeRequest[]): Promise<Blocker[]>
}
