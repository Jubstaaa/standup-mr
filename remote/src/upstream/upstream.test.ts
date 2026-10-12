import { describe, expect, test } from 'bun:test'
import * as oauth from 'oauth4webapi'

import { authorizationServer } from './upstream'

const client = { client_id: 'id' }

describe('authorizationServer', () => {
    test("accepts GitHub's callback with its iss parameter", () => {
        const callback = new URL(
            'https://standup.example.com/connect/callback/github?code=c&state=s&iss=https%3A%2F%2Fgithub.com%2Flogin%2Foauth'
        )
        expect(() =>
            oauth.validateAuthResponse(
                authorizationServer('github', 'github.com'),
                client,
                callback,
                's'
            )
        ).not.toThrow()
    })

    test('accepts a GitHub Enterprise callback with its own issuer', () => {
        const callback = new URL(
            'https://standup.example.com/connect/callback/github/ghe.example.com?code=c&state=s&iss=https%3A%2F%2Fghe.example.com%2Flogin%2Foauth'
        )
        expect(() =>
            oauth.validateAuthResponse(
                authorizationServer('github', 'ghe.example.com'),
                client,
                callback,
                's'
            )
        ).not.toThrow()
    })

    test('accepts a GitLab callback with or without iss', () => {
        const server = authorizationServer('gitlab', 'gitlab.com')
        for (const query of [
            'code=c&state=s',
            'code=c&state=s&iss=https%3A%2F%2Fgitlab.com',
        ]) {
            expect(() =>
                oauth.validateAuthResponse(
                    server,
                    client,
                    new URL(`https://standup.example.com/cb?${query}`),
                    's'
                )
            ).not.toThrow()
        }
    })

    test('still rejects a callback from another issuer', () => {
        const callback = new URL(
            'https://standup.example.com/cb?code=c&state=s&iss=https%3A%2F%2Fevil.example.com'
        )
        expect(() =>
            oauth.validateAuthResponse(
                authorizationServer('github', 'github.com'),
                client,
                callback,
                's'
            )
        ).toThrow()
    })
})
