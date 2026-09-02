export interface RawEvent {
    action_name: string
    created_at: string
    project_id?: number
    push_data?: {
        commit_count?: number
        commit_title?: string
        ref?: string
    }
    target_title?: string
    target_type?: string
}

export interface RawJob {
    id: number
    name: string
    stage: string
    status: string
}

export interface RawMr {
    author: { name: string }
    detailed_merge_status?: string | null
    draft: boolean
    iid: number
    project_id: number
    references: { full: string }
    source_branch: string
    target_branch: string
    title: string
    updated_at: string
    web_url: string
}

export interface RawNote {
    resolvable?: boolean
    resolved?: boolean
    system?: boolean
}
