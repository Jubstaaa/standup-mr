import { describe, expect, it } from 'bun:test'

import type { FetchLike, MergeRequest } from '../../types/standup.types'
import { GitLabProvider } from './gitlab'

function blockerFetch(routes: Record<string, unknown>): FetchLike {
    return async (url: string) => {
        for (const [needle, payload] of Object.entries(routes)) {
            if (url.includes(needle)) {
                return typeof payload === 'string'
                    ? new Response(payload, { status: 200 })
                    : new Response(JSON.stringify(payload), { status: 200 })
            }
        }
        return new Response('[]', { status: 200 })
    }
}

function mr(overrides: Partial<MergeRequest> = {}): MergeRequest {
    return {
        project: 'acme/web',
        projectId: 1,
        iid: 6,
        title: 'ci: release pipeline',
        draft: true,
        branch: 'ci/release',
        target: 'main',
        updated: '2026-08-25',
        url: 'https://h/acme/web/-/merge_requests/6',
        mergeStatus: 'unchecked',
        pipeline: 'failed',
        pipelineId: 99,
        unresolved: 0,
        pipelineMissing: false,
        bucket: 'draft',
        ...overrides,
    }
}

describe('getBlockers', () => {
    it('ignores merge requests whose pipeline is not failed', async () => {
        const gl = new GitLabProvider(
            'h',
            't',
            blockerFetch({
                '/pipelines/': [{ id: 2, name: 'quality', stage: 'test', status: 'failed' }],
                '/trace': 'error: this must not be reported\n',
            })
        )

        const rows = await gl.getBlockers([
            mr({ pipeline: 'success' }),
            mr({ pipeline: null, pipelineId: null }),
        ])
        expect(rows).toEqual([])
    })

    it('reports the first failed job with its extracted errors', async () => {
        const gl = new GitLabProvider(
            'h',
            't',
            blockerFetch({
                '/pipelines/99/jobs': [
                    { id: 1, name: 'lint', stage: 'test', status: 'success' },
                    { id: 2, name: 'quality', stage: 'test', status: 'failed' },
                    { id: 3, name: 'build', stage: 'build', status: 'failed' },
                ],
                '/jobs/2/trace': 'error: npm ci failed with 404\n',
            })
        )

        const [row] = await gl.getBlockers([mr()])
        expect(row).toMatchObject({
            project: 'acme/web',
            mr: 6,
            job: 'quality',
            stage: 'test',
            errors: ['error: npm ci failed with 404'],
        })
    })

    it('reports nothing when no job in the pipeline failed', async () => {
        const gl = new GitLabProvider(
            'h',
            't',
            blockerFetch({
                '/pipelines/99/jobs': [{ id: 1, name: 'lint', stage: 'test', status: 'success' }],
            })
        )

        expect(await gl.getBlockers([mr()])).toEqual([])
    })

    it('survives a jobs endpoint that returns nothing usable', async () => {
        const gl = new GitLabProvider('h', 't', async () => new Response('nope', { status: 500 }))

        expect(await gl.getBlockers([mr()])).toEqual([])
    })

    it('diagnoses several failed merge requests independently', async () => {
        const gl = new GitLabProvider(
            'h',
            't',
            blockerFetch({
                '/pipelines/99/jobs': [{ id: 2, name: 'quality', stage: 'test', status: 'failed' }],
                '/pipelines/77/jobs': [{ id: 5, name: 'deps', stage: 'setup', status: 'failed' }],
                '/jobs/2/trace': 'error: first one broke\n',
                '/jobs/5/trace': 'error: second one broke\n',
            })
        )

        const rows = await gl.getBlockers([
            mr(),
            mr({ projectId: 2, iid: 4, project: 'acme/mobile', pipelineId: 77 }),
        ])

        expect(rows).toHaveLength(2)
        expect(rows.map((r) => r.job).sort()).toEqual(['deps', 'quality'])
    })
})
