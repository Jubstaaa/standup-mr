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
    getBlockers(mrs: MergeRequest[]): Promise<Blocker[]>
    getEvents(since: Date): Promise<ActivityEvent[]>
    getIdentity(): Promise<Identity>
    getMyMrs(today: Date): Promise<MergeRequest[]>
    getReviews(identity: Identity, today: Date): Promise<Review[]>
    readonly kind: ProviderKind
}
