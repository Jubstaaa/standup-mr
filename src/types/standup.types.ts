export type ProviderKind = 'gitlab' | 'github'

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export type Bucket = 'ready' | 'blocked' | 'draft' | 'stale'

export interface Identity {
    id: number
    username: string
}

export interface ActivityEvent {
    at: string
    action: string
    project: string
    targetType: string
    title: string
    branch: string
    commits: number
    commitTitle: string
}

export interface MergeRequest {
    provider: ProviderKind
    project: string
    projectId: number
    iid: number
    title: string
    draft: boolean
    branch: string
    target: string
    updated: string
    url: string
    mergeStatus: string | null
    pipeline: string | null
    pipelineId: number | null
    unresolved: number
    pipelineMissing: boolean
    bucket: Bucket
}

export interface Review {
    provider: ProviderKind
    project: string
    iid: number
    title: string
    author: string
    updated: string
    draft: boolean
    url: string
    fresh: boolean
    approvedByMe: boolean
}

export interface Blocker {
    provider: ProviderKind
    project: string
    mr: number
    title: string
    job: string
    stage: string
    url: string
    errors: string[]
}

export interface StandupReport {
    provider: ProviderKind
    user: string
    today: { date: string; label: string }
    previous: {
        date: string | null
        label: string | null
        gapDays: number | null
        eventCount: number
    }
    previousEvents: ActivityEvent[]
    todayEvents: ActivityEvent[]
    myMrs: MergeRequest[]
    reviews: Review[]
    reviewPendingCount: number
    blockers: Blocker[]
}
