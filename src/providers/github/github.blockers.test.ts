import { describe, expect, it } from 'bun:test'

import type { MergeRequest } from '../../types/standup.types'
import { REDIRECT, routedFetch } from '../base/routes.helpers'
import { GitHubProvider } from './github'

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
    '/actions/jobs/901/logs': REDIRECT,
    '/log': '2026-08-28T09:12:02.0000000Z npm ERR! code E404\n2026-08-28T09:12:04.0000000Z ##[error]Process completed with exit code 1.\n',
}

const TIMED_OUT_ROUTES = {
    '/pulls/6': ACTIONS_ROUTES['/pulls/6'],
    '/actions/runs/500/jobs': { jobs: [{ id: 901, name: 'quality', conclusion: 'timed_out' }] },
    '/actions/runs': { workflow_runs: [{ id: 500, name: 'release', conclusion: 'timed_out' }] },
    '/actions/jobs/901/logs': REDIRECT,
    '/log': '2026-08-28T09:12:02.0000000Z ##[error]The operation was canceled after the job timed out.\n',
}

describe('getBlockers', () => {
    it('ignores pull requests whose checks are not failed', async () => {
        const gh = new GitHubProvider('github.com', 't', routedFetch(ACTIONS_ROUTES))

        await expect(gh.getBlockers([pr({ pipeline: 'success' })])).resolves.toEqual([])
    })

    it('walks run to job to log and reports the error lines', async () => {
        const gh = new GitHubProvider('github.com', 't', routedFetch(ACTIONS_ROUTES))

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
            routedFetch({
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
            routedFetch({
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
            routedFetch({ '/pulls/6': { number: 6, title: 't', draft: false, html_url: 'u', updated_at: '2026-08-25T09:00:00Z' } })
        )

        await expect(gh.getBlockers([pr()])).resolves.toEqual([])
    })

    it('diagnoses several failed pull requests', async () => {
        const gh = new GitHubProvider('github.com', 't', routedFetch(ACTIONS_ROUTES))

        const blockers = await gh.getBlockers([pr(), pr({ iid: 6, project: 'acme/web' })])
        expect(blockers).toHaveLength(2)
    })

    it('reaches the actions log when the run and its job timed out rather than failed', async () => {
        const gh = new GitHubProvider('github.com', 't', routedFetch(TIMED_OUT_ROUTES))

        const [blocker] = await gh.getBlockers([pr()])
        expect(blocker).toMatchObject({ job: 'quality', stage: 'release' })
        expect(blocker!.errors).toEqual([
            'The operation was canceled after the job timed out.',
        ])
    })

    it('falls back to the check run summary when the actions log yields no error lines', async () => {
        const gh = new GitHubProvider(
            'github.com',
            't',
            routedFetch({
                '/pulls/6': ACTIONS_ROUTES['/pulls/6'],
                '/actions/runs/500/jobs': ACTIONS_ROUTES['/actions/runs/500/jobs'],
                '/actions/runs': ACTIONS_ROUTES['/actions/runs'],
                '/actions/jobs/901/logs': '',
                '/commits/abc123/check-runs': {
                    check_runs: [
                        {
                            id: 4,
                            name: 'quality',
                            status: 'completed',
                            conclusion: 'failure',
                            app: { slug: 'github-actions' },
                            output: { summary: 'error: real reason here', text: null },
                        },
                    ],
                },
            })
        )

        const [blocker] = await gh.getBlockers([pr()])
        expect(blocker).toMatchObject({ job: 'quality', stage: 'github-actions' })
        expect(blocker!.errors).toEqual(['error: real reason here'])
    })

    it('still names the failed actions job when nothing diagnostic exists anywhere', async () => {
        const gh = new GitHubProvider(
            'github.com',
            't',
            routedFetch({
                '/pulls/6': ACTIONS_ROUTES['/pulls/6'],
                '/actions/runs/500/jobs': ACTIONS_ROUTES['/actions/runs/500/jobs'],
                '/actions/runs': ACTIONS_ROUTES['/actions/runs'],
                '/actions/jobs/901/logs': '',
                '/commits/abc123/check-runs': { check_runs: [] },
            })
        )

        const [blocker] = await gh.getBlockers([pr()])
        expect(blocker).toMatchObject({ job: 'quality', stage: 'release', errors: [] })
    })
})
