export interface RawCommit {
    message?: string
}

export interface RawEvent {
    created_at: string
    payload?: {
        action?: string
        ref?: string
        size?: number
        commits?: RawCommit[]
        pull_request?: { title?: string }
        issue?: { title?: string }
    }
    repo?: { name?: string }
    type?: string
}

export interface SearchItem {
    draft?: boolean
    html_url: string
    number: number
    repository_url: string
    title: string
    updated_at: string
    user?: { login?: string }
}

export interface PullDetail {
    base?: { ref?: string; repo?: { id?: number } }
    draft: boolean
    head?: { ref?: string; sha?: string }
    html_url: string
    mergeable_state?: string | null
    number: number
    title: string
    updated_at: string
    user?: { login?: string; name?: string | null }
}

export interface PullReview {
    state: string
    submitted_at?: string
    user?: { login?: string }
}

export interface CheckRun {
    id: number
    app?: { slug?: string } | null
    conclusion: string | null
    name: string
    output?: { summary?: string | null; text?: string | null } | null
    status: string
}

export interface WorkflowRun {
    id: number
    conclusion: string | null
    name?: string | null
}

export interface WorkflowJob {
    id: number
    conclusion: string | null
    name: string
}
