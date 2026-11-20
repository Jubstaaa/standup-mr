import { describe, expect, test } from 'bun:test'

import { connectCookie } from './connect-cookie'

describe('connectCookie', () => {
    // __Host- is only accepted with Secure, Path=/ and no Domain, so the name
    // and the attributes have to be decided together.
    test('a __Host- cookie on the root path over https', () => {
        expect(connectCookie(new URL('https://standup.example.com/'))).toEqual({
            name: '__Host-standup_connect',
            options: {
                httpOnly: true,
                path: '/',
                sameSite: 'lax',
                secure: true,
            },
        })
    })

    test('a plain cookie scoped to the connect pages over http', () => {
        expect(connectCookie(new URL('http://localhost:3000/'))).toEqual({
            name: 'standup_connect',
            options: {
                httpOnly: true,
                path: '/connect',
                sameSite: 'lax',
                secure: false,
            },
        })
    })
})
