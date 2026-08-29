import { describe, expect, it } from 'bun:test'

import type { FetchLike, MergeRequest } from '../../types/standup.types'
import { GitHubProvider } from './github'

function blockerFetch(routes: Record<string, unknown>): FetchLike {
    return async (url: string) => {
        for (const [needle, payload] of Object.entries(routes)) {
            if (url.includes(needle)) {
                if (payload === 'REDIRECT') {
                    return new Response(null, {
                        status: 302,
                        headers: { location: 'https://blob.example.com/log' },
                    })
                }
                return typeof payload === 'string'
                    ? new Response(payload, { status: 200 })
                    : new Response(JSON.stringify(payload), { status: 200 })
            }
        }
        return new Response('[]', { status: 200 })
    }
}

function pr(overrides: Partial<MergeRequest> = {}): MergeRequest {
    return {
        provider: 'github',
        project: 'acme/web',
        projectId: 1,
        iid: 6,
        title: 'ci: release pipeline',
        draft: false,
        branch: 'ci/release',
        target: 'main',
        updated: '2026-08-25',
        url: 'https://github.com/acme/web/pull/6',
        mergeStatus: 'unstable',
        pipeline: 'failed',
        pipelineId: 99,
        unresolved: 0,
        pipelineMissing: false,
        bucket: 'blocked',
        ...overrides,
    }
}

const ACTIONS_ROUTES = {
    '/pulls/6': { number: 6, title: 'ci: release pipeline', draft: false, html_url: 'u', updated_at: '2026-08-25T09:00:00Z', head: { ref: 'ci/release', sha: 'abc123' }, base: { ref: 'main', repo: { id: 1 } } },
    '/actions/runs/500/jobs': { jobs: [{ id: 900, name: 'build', conclusion: 'success' }, { id: 901, name: 'quality', conclusion: 'failure' }] },
    '/actions/runs': { workflow_runs: [{ id: 499, name: 'nightly', conclusion: 'success' }, { id: 500, name: 'release', conclusion: 'failure' }] },
    '/actions/jobs/901/logs': 'REDIRECT',
    'blob.example.com': '2026-08-28T09:12:02.0000000Z npm ERR! code E404\n2026-08-28T09:12:04.0000000Z ##[error]Process completed with exit code 1.\n',
}

describe('getBlockers', () => {
    it('ignores pull requests whose checks are not failed', async () => {
        const gh = new GitHubProvider('github.com', 't', blockerFetch(ACTIONS_ROUTES))

        await expect(gh.getBlockers([pr({ pipeline: 'success' })])).resolves.toEqual([])
    })

    it('walks run to job to log and reports the error lines', async () => {
        const gh = new GitHubProvider('github.com', 't', blockerFetch(ACTIONS_ROUTES))

        const [blocker] = await gh.getBlockers([pr()])
        expect(blocker).toMatchObject({
            provider: 'github',
            project: 'acme/web',
            mr: 6,
            job: 'quality',
            stage: 'release',
            url: 'https://github.com/acme/web/pull/6',
        })
        expect(blocker!.errors).toEqual([
            'npm ERR! code E404',
            'Process completed with exit code 1.',
        ])
    })

    it('falls back to the check run summary when the failure is not an actions job', async () => {
        const gh = new GitHubProvider(
            'github.com',
            't',
            blockerFetch({
                '/pulls/6': ACTIONS_ROUTES['/pulls/6'],
                '/actions/runs': { workflow_runs: [] },
                '/commits/abc123/check-runs': {
                    check_runs: [
                        {
                            id: 3,
                            name: 'circleci: build',
                            status: 'completed',
                            conclusion: 'failure',
                            app: { slug: 'circleci-checks' },
                            output: {
                                summary: 'error: bundle exec rspec failed',
                                text: 'fatal: 3 examples, 1 failure',
                            },
                        },
                    ],
                },
            })
        )

        const [blocker] = await gh.getBlockers([pr()])
        expect(blocker).toMatchObject({ job: 'circleci: build', stage: 'circleci-checks' })
        expect(blocker!.errors).toEqual([
            'error: bundle exec rspec failed',
            'fatal: 3 examples, 1 failure',
        ])
    })

    it('reports nothing when no failed job and no usable summary can be found', async () => {
        const gh = new GitHubProvider(
            'github.com',
            't',
            blockerFetch({
                '/pulls/6': ACTIONS_ROUTES['/pulls/6'],
                '/actions/runs': { workflow_runs: [] },
                '/commits/abc123/check-runs': {
                    check_runs: [
                        {
                            id: 3,
                            name: 'lint',
                            status: 'completed',
                            conclusion: 'failure',
                            app: { slug: 'github-actions' },
                            output: { summary: null, text: null },
                        },
                    ],
                },
            })
        )

        await expect(gh.getBlockers([pr()])).resolves.toEqual([])
    })

    it('reports nothing when the head sha cannot be read', async () => {
        const gh = new GitHubProvider(
            'github.com',
            't',
            blockerFetch({ '/pulls/6': { number: 6, title: 't', draft: false, html_url: 'u', updated_at: '2026-08-25T09:00:00Z' } })
        )

        await expect(gh.getBlockers([pr()])).resolves.toEqual([])
    })

    it('diagnoses several failed pull requests', async () => {
        const gh = new GitHubProvider('github.com', 't', blockerFetch(ACTIONS_ROUTES))

        const blockers = await gh.getBlockers([pr(), pr({ iid: 6, project: 'acme/web' })])
        expect(blockers).toHaveLength(2)
    })
})
