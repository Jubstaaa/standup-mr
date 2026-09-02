export interface BucketInput {
    draft: boolean
    pipeline: string | null
    unresolved: number
    updated: string
}

export interface PipelineInput {
    pipeline: string | null
    pipelineMissing?: boolean
    project: string
}
