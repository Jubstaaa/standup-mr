export type ProviderKind = 'gitlab' | 'github'

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export type Bucket = 'ready' | 'blocked' | 'draft' | 'stale'

export interface Identity {
    id: number
    username: string
}

export interface ActivityEvent {
    action: string
    at: string
    branch: string
    commits: number
    commitTitle: string
    project: string
    targetType: string
    title: string
}

export interface MergeRequest {
    branch: string
    bucket: Bucket
    draft: boolean
    iid: number
    mergeStatus: string | null
    pipeline: string | null
    pipelineId: number | null
    pipelineMissing: boolean
    project: string
    projectId: number
    provider: ProviderKind
    target: string
    title: string
    unresolved: number
    updated: string
    url: string
}

export interface Review {
    approvedByMe: boolean
    author: string
    draft: boolean
    fresh: boolean
    iid: number
    project: string
    provider: ProviderKind
    title: string
    updated: string
    url: string
}

export interface Blocker {
    errors: string[]
    job: string
    mr: number
    project: string
    provider: ProviderKind
    stage: string
    title: string
    url: string
}

export interface ActiveDay {
    date: string
    events: ActivityEvent[]
    gapDays: number
    label: string
}

export interface StandupReport {
    blockers: Blocker[]
    myMrs: MergeRequest[]
    previousDays: ActiveDay[]
    provider: ProviderKind
    reviewPendingCount: number
    reviews: Review[]
    today: { date: string; label: string }
    todayEvents: ActivityEvent[]
    user: string
}
