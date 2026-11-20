import { describe, expect, it } from 'bun:test'

import type { FetchLike, MergeRequest } from '../../standup.types'
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
    '/pulls/6': {
        number: 6,
        title: 'ci: release pipeline',
        draft: false,
        html_url: 'u',
        updated_at: '2026-08-25T09:00:00Z',
        head: { ref: 'ci/release', sha: 'abc123' },
        base: { ref: 'main', repo: { id: 1 } },
    },
    '/actions/runs/500/jobs': {
        jobs: [
            { id: 900, name: 'build', conclusion: 'success' },
            { id: 901, name: 'quality', conclusion: 'failure' },
        ],
    },
    '/actions/runs': {
        workflow_runs: [
            { id: 499, name: 'nightly', conclusion: 'success' },
            { id: 500, name: 'release', conclusion: 'failure' },
        ],
    },
    '/actions/jobs/901/logs': REDIRECT,
    '/log': '2026-08-28T09:12:02.0000000Z npm ERR! code E404\n2026-08-28T09:12:04.0000000Z ##[error]Process completed with exit code 1.\n',
}

const TIMED_OUT_ROUTES = {
    '/pulls/6': ACTIONS_ROUTES['/pulls/6'],
    '/actions/runs/500/jobs': {
        jobs: [{ id: 901, name: 'quality', conclusion: 'timed_out' }],
    },
    '/actions/runs': {
        workflow_runs: [{ id: 500, name: 'release', conclusion: 'timed_out' }],
    },
    '/actions/jobs/901/logs': REDIRECT,
    '/log': '2026-08-28T09:12:02.0000000Z ##[error]The operation was canceled after the job timed out.\n',
}

describe('getBlockers', () => {
    it('ignores pull requests whose checks are not failed', async () => {
        const gh = new GitHubProvider(
            'github.com',
            't',
            routedFetch(ACTIONS_ROUTES)
        )

        await expect(
            gh.getBlockers([pr({ pipeline: 'success' })])
        ).resolves.toEqual([])
    })

    it('walks run to job to log and reports the error lines', async () => {
        const gh = new GitHubProvider(
            'github.com',
            't',
            routedFetch(ACTIONS_ROUTES)
        )

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
        expect(blocker).toMatchObject({
            job: 'circleci: build',
            stage: 'circleci-checks',
        })
        expect(blocker!.errors).toEqual([
            'error: bundle exec rspec failed',
            'fatal: 3 examples, 1 failure',
        ])
    })

    it('keeps the red pull request as undiagnosed when no failed job or usable summary is found', async () => {
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

        const [blocker] = await gh.getBlockers([pr()])
        expect(blocker).toMatchObject({ mr: 6, job: 'unknown' })
        expect(blocker!.errors[0]).toMatch(
            /diagnosis unavailable: no failed job found for commit abc123/
        )
    })

    it('keeps the red pull request as undiagnosed when the head sha cannot be read', async () => {
        const gh = new GitHubProvider(
            'github.com',
            't',
            routedFetch({
                '/pulls/6': {
                    number: 6,
                    title: 't',
                    draft: false,
                    html_url: 'u',
                    updated_at: '2026-08-25T09:00:00Z',
                },
            })
        )

        const [blocker] = await gh.getBlockers([pr()])
        expect(blocker!.errors[0]).toMatch(/head commit .* could not be read/)
    })

    it('asks only for the latest attempt of each job', async () => {
        const urls: string[] = []
        const inner = routedFetch(ACTIONS_ROUTES)
        const gh = new GitHubProvider('github.com', 't', async (url, init) => {
            urls.push(url)
            return await inner(url, init)
        })

        await gh.getBlockers([pr()])

        expect(urls.find(url => url.includes('/runs/500/jobs'))).toContain(
            'filter=latest'
        )
    })

    it('names the job when its log cannot be downloaded', async () => {
        const gh = new GitHubProvider('github.com', 't', async (url, init) =>
            url.startsWith('https://blob.example.com')
                ? new Response('denied', { status: 403 })
                : await routedFetch(ACTIONS_ROUTES)(url, init)
        )

        const [blocker] = await gh.getBlockers([pr()])

        expect(blocker).toMatchObject({ job: 'quality' })
        expect(blocker!.errors).toEqual(['job log unavailable: HTTP 403'])
    })

    it('diagnoses several failed pull requests', async () => {
        const gh = new GitHubProvider(
            'github.com',
            't',
            routedFetch(ACTIONS_ROUTES)
        )

        const blockers = await gh.getBlockers([
            pr(),
            pr({ iid: 6, project: 'acme/web' }),
        ])
        expect(blockers).toHaveLength(2)
    })

    it('reaches the actions log when the run and its job timed out rather than failed', async () => {
        const gh = new GitHubProvider(
            'github.com',
            't',
            routedFetch(TIMED_OUT_ROUTES)
        )

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
                '/actions/runs/500/jobs':
                    ACTIONS_ROUTES['/actions/runs/500/jobs'],
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
                            output: {
                                summary: 'error: real reason here',
                                text: null,
                            },
                        },
                    ],
                },
            })
        )

        const [blocker] = await gh.getBlockers([pr()])
        expect(blocker).toMatchObject({
            job: 'quality',
            stage: 'github-actions',
        })
        expect(blocker!.errors).toEqual(['error: real reason here'])
    })

    it('still names the failed actions job when nothing diagnostic exists anywhere', async () => {
        const gh = new GitHubProvider(
            'github.com',
            't',
            routedFetch({
                '/pulls/6': ACTIONS_ROUTES['/pulls/6'],
                '/actions/runs/500/jobs':
                    ACTIONS_ROUTES['/actions/runs/500/jobs'],
                '/actions/runs': ACTIONS_ROUTES['/actions/runs'],
                '/actions/jobs/901/logs': '',
                '/commits/abc123/check-runs': { check_runs: [] },
            })
        )

        const [blocker] = await gh.getBlockers([pr()])
        expect(blocker).toMatchObject({
            job: 'quality',
            stage: 'release',
            errors: [],
        })
    })
})

describe('getBlockers when the diagnosis itself fails', () => {
    it('reports an undiagnosed blocker instead of losing the whole note', async () => {
        const gh = new GitHubProvider(
            'github.com',
            't',
            async () => new Response('', { status: 403 })
        )

        const [blocker] = await gh.getBlockers([pr()])
        expect(blocker).toMatchObject({
            provider: 'github',
            project: 'acme/web',
            mr: 6,
            job: 'unknown',
            stage: 'unknown',
        })
        expect(blocker!.errors[0]).toMatch(/diagnosis unavailable.*403/i)
    })

    it('keeps the diagnosis of the pull requests that did answer', async () => {
        const routes = routedFetch(ACTIONS_ROUTES)
        const mixed: FetchLike = async (url, init) => {
            if (url.includes('acme/api'))
                return new Response('', { status: 403 })
            return routes(url, init)
        }
        const gh = new GitHubProvider('github.com', 't', mixed)

        const blockers = await gh.getBlockers([
            pr(),
            pr({ project: 'acme/api', iid: 9 }),
        ])
        expect(blockers).toHaveLength(2)
        expect(blockers.find(b => b.mr === 6)!.job).toBe('quality')
        expect(blockers.find(b => b.mr === 9)!.errors[0]).toMatch(
            /diagnosis unavailable/i
        )
    })

    it('never degrades a 401, so a revoked token still fails loudly', async () => {
        const gh = new GitHubProvider(
            'github.com',
            't',
            async () => new Response('', { status: 401 })
        )

        await expect(gh.getBlockers([pr()])).rejects.toThrow(/token/i)
    })
})
