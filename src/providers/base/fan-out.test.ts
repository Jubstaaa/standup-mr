import { describe, expect, it } from 'bun:test'

import type { FetchLike } from '../../standup.types'
import { GitHubProvider } from '../github/github'
import { GitLabProvider } from '../gitlab/gitlab'

import { REQUEST_CONCURRENCY } from './http'
import { routedFetch } from './routes.helpers'

const ITEMS = 25

// Holds every request for a tick so the test sees how many a provider has
// in flight at once, the number GitHub's secondary rate limit punishes.
function trackingFetch(routes: Record<string, unknown>) {
    const inner = routedFetch(routes)
    let inFlight = 0
    let peak = 0
    const impl: FetchLike = async (url, init) => {
        inFlight += 1
        peak = Math.max(peak, inFlight)
        await new Promise(resolve => setTimeout(resolve, 2))
        try {
            return await inner(url, init)
        } finally {
            inFlight -= 1
        }
    }
    return { impl, peak: () => peak }
}

function searchItems() {
    return Array.from({ length: ITEMS }, (_, n) => ({
        number: n + 1,
        title: `pr ${n + 1}`,
        html_url: `https://github.com/acme/web/pull/${n + 1}`,
        repository_url: 'https://api.github.com/repos/acme/web',
        updated_at: '2026-08-27T10:00:00Z',
    }))
}

function gitlabMrs() {
    return Array.from({ length: ITEMS }, (_, n) => ({
        project_id: n + 1,
        iid: n + 1,
        title: `mr ${n + 1}`,
        draft: false,
        source_branch: 'b',
        target_branch: 'main',
        updated_at: '2026-08-27T10:00:00Z',
        web_url: `https://h/acme/web/-/merge_requests/${n + 1}`,
        references: { full: `acme/web!${n + 1}` },
        author: { name: 'Dev' },
    }))
}

describe('provider fan-out', () => {
    it('caps concurrent GitHub review lookups', async () => {
        const { impl, peak } = trackingFetch({
            'search/issues': { items: searchItems() },
            'reviews': [],
        })
        const gh = new GitHubProvider('github.com', 't', impl)

        const rows = await gh.getReviews(
            { id: 1, username: 'me' },
            new Date(2026, 7, 28)
        )

        expect(rows).toHaveLength(ITEMS)
        expect(peak()).toBeLessThanOrEqual(REQUEST_CONCURRENCY)
    })

    it('caps concurrent GitLab approval lookups', async () => {
        const { impl, peak } = trackingFetch({
            'reviewer_id=': gitlabMrs(),
            'approvals': { approved_by: [] },
        })
        const gl = new GitLabProvider('h', 't', impl)

        const rows = await gl.getReviews(
            { id: 1, username: 'me' },
            new Date(2026, 7, 28)
        )

        expect(rows).toHaveLength(ITEMS)
        expect(peak()).toBeLessThanOrEqual(REQUEST_CONCURRENCY)
    })

    it('caps concurrent GitLab project path lookups', async () => {
        const events = Array.from({ length: ITEMS }, (_, n) => ({
            created_at: '2026-08-27T10:00:00Z',
            action_name: 'pushed to',
            project_id: n + 1,
        }))
        const { impl, peak } = trackingFetch({
            '/events': events,
            'projects/': { path_with_namespace: 'acme/web' },
        })
        const gl = new GitLabProvider('h', 't', impl)

        const rows = await gl.getEvents(new Date(2026, 7, 20))

        expect(rows).toHaveLength(ITEMS)
        expect(peak()).toBeLessThanOrEqual(REQUEST_CONCURRENCY)
    })

    it('caps concurrent merge request shaping on both providers', async () => {
        const github = trackingFetch({
            'search/issues': { items: searchItems() },
            'reviews': [],
            'check-runs': { check_runs: [] },
        })
        const gitlab = trackingFetch({
            'scope=created_by_me': gitlabMrs(),
            'discussions': [],
        })

        await new GitHubProvider('github.com', 't', github.impl).getMyMrs(
            new Date(2026, 7, 28)
        )
        await new GitLabProvider('h', 't', gitlab.impl).getMyMrs(
            new Date(2026, 7, 28)
        )

        // Each merge request makes two lookups side by side.
        expect(github.peak()).toBeLessThanOrEqual(REQUEST_CONCURRENCY * 2)
        expect(gitlab.peak()).toBeLessThanOrEqual(REQUEST_CONCURRENCY * 2)
    })
})
