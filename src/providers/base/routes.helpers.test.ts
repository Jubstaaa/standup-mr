import { describe, expect, it } from 'bun:test'

import { REDIRECT, routedFetch } from './routes.helpers'

describe('routedFetch', () => {
    it('does not let a shorter path key swallow a longer url', async () => {
        const fetchImpl = routedFetch({
            '/user': { id: 1 },
            '/users/dev/events': [{ type: 'PushEvent' }],
        })

        const me = await fetchImpl('https://api.github.com/user')
        const events = await fetchImpl('https://api.github.com/users/dev/events?page=1')

        expect(await me.text()).toBe('{"id":1}')
        expect(await events.text()).toBe('[{"type":"PushEvent"}]')
    })

    it('does not let a pull request key swallow its reviews url', async () => {
        const fetchImpl = routedFetch({
            '/pulls/11': { number: 11 },
            '/pulls/11/reviews': [{ state: 'APPROVED' }],
        })

        const pull = await fetchImpl('https://api.github.com/repos/acme/api/pulls/11')
        const reviews = await fetchImpl(
            'https://api.github.com/repos/acme/api/pulls/11/reviews?per_page=100'
        )

        expect(await pull.text()).toBe('{"number":11}')
        expect(await reviews.text()).toBe('[{"state":"APPROVED"}]')
    })

    it('ignores the query string when matching a path key', async () => {
        const fetchImpl = routedFetch({ '/actions/runs': { workflow_runs: [] } })
        const runs = await fetchImpl(
            'https://api.github.com/repos/acme/web/actions/runs?head_sha=abc&per_page=10'
        )

        expect(await runs.text()).toBe('{"workflow_runs":[]}')
    })

    it('matches a key holding an = against the query string instead', async () => {
        const fetchImpl = routedFetch({ 'scope=created_by_me': [{ iid: 7 }] })

        const mine = await fetchImpl('https://h/api/v4/merge_requests?scope=created_by_me')
        const other = await fetchImpl('https://h/api/v4/merge_requests?scope=all')

        expect(await mine.text()).toBe('[{"iid":7}]')
        expect(await other.text()).toBe('[]')
    })

    it('answers a REDIRECT route with a 302 to the blob host', async () => {
        const fetchImpl = routedFetch({ '/logs': REDIRECT })
        const response = await fetchImpl(
            'https://api.github.com/repos/acme/web/actions/jobs/9/logs'
        )

        expect(response.status).toBe(302)
        expect(response.headers.get('location')).toBe('https://blob.example.com/log')
    })

    it('falls back to an empty array for an unrouted url', async () => {
        const fetchImpl = routedFetch({})
        const response = await fetchImpl('https://h/api/v4/anything')

        expect(await response.text()).toBe('[]')
    })
})
