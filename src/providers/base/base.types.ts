import type {
    ActivityEvent,
    Blocker,
    Identity,
    MergeRequest,
    ProviderKind,
    Review,
} from '../../standup.types'

export type { ProviderKind }

export interface Provider {
    getBlockers(mrs: MergeRequest[]): Promise<Blocker[]>
    getEvents(since: Date): Promise<ActivityEvent[]>
    getIdentity(): Promise<Identity>
    getMyMrs(today: Date): Promise<MergeRequest[]>
    getReviews(identity: Identity, today: Date): Promise<Review[]>
    readonly kind: ProviderKind
    // Things the report should say it could not see, such as a private
    // activity feed; optional so existing Provider implementations still fit.
    warnings?(): string[]
}
