export interface BucketInput {
    draft: boolean
    pipeline: string | null
    unresolved: number
    updated: string
}

export interface PipelineInput {
    project: string
    pipeline: string | null
    pipelineMissing?: boolean
}
