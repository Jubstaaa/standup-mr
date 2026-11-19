import { afterEach, describe, expect, it, spyOn } from 'bun:test'

import { postWebhook } from '../../notify/notify'
import { GitHubProvider } from '../github/github'
import { GitLabProvider } from '../gitlab/gitlab'

// Without a fetchImpl every outbound call must still carry a timeout signal,
// or a stalled host hangs the CLI and the MCP tool call.
function captureSignals() {
    const signals: Array<AbortSignal | null | undefined> = []
    const spy = spyOn(globalThis, 'fetch').mockImplementation((async (
        _url: string | URL | Request,
        init?: RequestInit
    ) => {
        signals.push(init?.signal)
        return new Response(
            JSON.stringify({ id: 1, login: 'me', username: 'me' }),
            {
                status: 200,
            }
        )
    }) as typeof fetch)
    return { signals, spy }
}

describe('default transport', () => {
    let restore: (() => void) | undefined
    afterEach(() => restore?.())

    it('times out GitHub API calls', async () => {
        const { signals, spy } = captureSignals()
        restore = () => spy.mockRestore()
        await new GitHubProvider('github.com', 'tok').getIdentity()
        expect(signals[0]).toBeInstanceOf(AbortSignal)
    })

    it('times out GitLab API calls', async () => {
        const { signals, spy } = captureSignals()
        restore = () => spy.mockRestore()
        await new GitLabProvider('gitlab.com', 'tok').getIdentity()
        expect(signals[0]).toBeInstanceOf(AbortSignal)
    })

    it('times out webhook posts', async () => {
        const { signals, spy } = captureSignals()
        restore = () => spy.mockRestore()
        await postWebhook('https://hooks.slack.com/services/x', 'hi')
        expect(signals[0]).toBeInstanceOf(AbortSignal)
    })
})
