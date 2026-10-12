import { randomBytes } from 'node:crypto'

import { beforeEach, describe, expect, test } from 'bun:test'

import { createTokenRefresher } from '../accounts/accounts'
import { Store } from '../store/store'
import { startConnection } from '../store/store.fixtures'

import { createRemoteServer, runRemotePost, runRemoteStandup } from './tools'
import type { ToolContext } from './tools'
import { NO_WEBHOOK_MESSAGE } from './tools.constants'

let context: ToolContext
let posted: Array<{ body: string; url: string }>

beforeEach(() => {
    const store = new Store(':memory:', randomBytes(32))
    const { connectionId } = startConnection(store)
    posted = []
    context = {
        connectionId,
        freshAccessToken: createTokenRefresher({}, store),
        now: () => 0,
        store,
        fetchImpl: async (url, init) => {
            posted.push({ url, body: String(init?.body) })
            return new Response('ok')
        },
    }
})

describe('get_standup_data', () => {
    test('fails with a reconnect hint when nothing is linked', async () => {
        const result = await runRemoteStandup({}, context)
        expect(result.isError).toBe(true)
        expect(result.content[0]!.text).toMatch(/No account is linked/)
    })

    test('reports a host the guarded fetch refuses', async () => {
        context.store.addAccount({
            connectionId: context.connectionId,
            provider: 'gitlab',
            host: 'git.example.com',
            username: 'ilker',
            source: 'pat',
            accessToken: 'glpat',
            refreshToken: null,
            expiresAt: null,
        })
        context.fetchImpl = async () => {
            throw new Error('git.example.com points to a private address.')
        }
        const result = await runRemoteStandup({}, context)
        expect(result.isError).toBe(true)
        expect(result.content[0]!.text).toContain('private address')
    })
})

describe('post_standup_note', () => {
    test('explains how to add a webhook when none is saved', async () => {
        const result = await runRemotePost({ text: 'note' }, context)
        expect(result.isError).toBe(true)
        expect(result.content[0]!.text).toBe(NO_WEBHOOK_MESSAGE)
    })

    test('posts to the saved webhook', async () => {
        context.store.setWebhook(context.connectionId, {
            kind: 'slack',
            url: 'https://hooks.slack.com/services/T/B/X',
        })
        const result = await runRemotePost(
            { text: 'Yesterday: shipped' },
            context
        )
        expect(result.isError).toBeUndefined()
        expect(posted[0]!.url).toBe('https://hooks.slack.com/services/T/B/X')
        expect(posted[0]!.body).toContain('shipped')
    })
})

test('registers the three tools', () => {
    expect(() => createRemoteServer(context)).not.toThrow()
})
