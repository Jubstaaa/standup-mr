import type {
    ActivityEvent,
    Blocker,
    Identity,
    MergeRequest,
    ProviderKind,
    Review,
} from '../../types/standup.types'

export type { ProviderKind }

export interface Provider {
    readonly kind: ProviderKind
    getIdentity(): Promise<Identity>
    getEvents(since: Date): Promise<ActivityEvent[]>
    getMyMrs(today: Date): Promise<MergeRequest[]>
    getReviews(identity: Identity, today: Date): Promise<Review[]>
    getBlockers(mrs: MergeRequest[]): Promise<Blocker[]>
}
