import { describe, expect, it } from 'bun:test'

import { classify, markMissingPipelines } from './buckets'

const TODAY = new Date(2026, 7, 28)

function mr(overrides: Record<string, unknown> = {}) {
    return {
        project: 'acme/web',
        draft: false,
        pipeline: 'success' as string | null,
        unresolved: 0,
        updated: '2026-08-27',
        ...overrides,
    }
}

describe('classify', () => {
    it('puts draft ahead of everything', () => {
        expect(classify(mr({ draft: true, pipeline: 'failed' }), TODAY)).toBe('draft')
    })

    it('treats a failed pipeline as blocked', () => {
        expect(classify(mr({ pipeline: 'failed' }), TODAY)).toBe('blocked')
    })

    it('treats unresolved discussions as blocked', () => {
        expect(classify(mr({ unresolved: 2 }), TODAY)).toBe('blocked')
    })

    it('treats an old but green merge request as stale', () => {
        expect(classify(mr({ updated: '2026-07-24' }), TODAY)).toBe('stale')
    })

    it('treats a recent green merge request as ready', () => {
        expect(classify(mr(), TODAY)).toBe('ready')
    })
})

describe('markMissingPipelines', () => {
    it('flags a pipeline-less merge request when the project has CI elsewhere', () => {
        const rows = [
            mr({ project: 'acme/web', pipeline: null }),
            mr({ project: 'acme/web', pipeline: 'success' }),
        ]
        markMissingPipelines(rows)
        expect(rows[0]).toMatchObject({ pipelineMissing: true })
        expect(rows[1]).toMatchObject({ pipelineMissing: false })
    })

    it('does not flag a project with no CI at all', () => {
        const rows = [
            mr({ project: 'acme/docs', pipeline: null }),
            mr({ project: 'acme/docs', pipeline: null }),
        ]
        markMissingPipelines(rows)
        expect(
            rows.every((r) => (r as { pipelineMissing?: boolean }).pipelineMissing === false)
        ).toBe(true)
    })

    it('scopes the check per project', () => {
        const rows = [
            mr({ project: 'acme/docs', pipeline: null }),
            mr({ project: 'acme/web', pipeline: 'success' }),
        ]
        markMissingPipelines(rows)
        expect(rows[0]).toMatchObject({ pipelineMissing: false })
    })

    it('returns nothing and mutates in place', () => {
        const rows = [mr({ pipeline: null })]
        expect(markMissingPipelines(rows)).toBeUndefined()
        expect(rows[0]).toHaveProperty('pipelineMissing')
    })
})
