export interface RawCommit {
    message?: string
}

export interface RawEvent {
    type?: string
    created_at: string
    repo?: { name?: string }
    payload?: {
        action?: string
        ref?: string
        size?: number
        commits?: RawCommit[]
        pull_request?: { title?: string }
        issue?: { title?: string }
    }
}

export interface SearchItem {
    number: number
    title: string
    html_url: string
    updated_at: string
    draft?: boolean
    repository_url: string
    user?: { login?: string }
}

export interface PullDetail {
    number: number
    title: string
    draft: boolean
    html_url: string
    updated_at: string
    mergeable_state?: string | null
    head?: { ref?: string; sha?: string }
    base?: { ref?: string; repo?: { id?: number } }
    user?: { login?: string; name?: string | null }
}

export interface PullReview {
    state: string
    submitted_at?: string
    user?: { login?: string }
}

export interface CheckRun {
    id: number
    name: string
    status: string
    conclusion: string | null
    app?: { slug?: string } | null
    output?: { summary?: string | null; text?: string | null } | null
}

export interface WorkflowRun {
    id: number
    name?: string | null
    conclusion: string | null
}

export interface WorkflowJob {
    id: number
    name: string
    conclusion: string | null
}
