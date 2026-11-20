import type { CookieOptions } from 'express'

import { CONNECT_COOKIE, SECURE_CONNECT_COOKIE } from './connect.constants'

// The OAuth authorize step sets this cookie and the connect pages read it;
// both call this with the configured site URL, so the name and the
// attributes (__Host- requires Secure and the root path) never drift apart.
export function connectCookie(siteUrl: URL): {
    name: string
    options: CookieOptions
} {
    const secure = siteUrl.protocol === 'https:'
    return {
        name: secure ? SECURE_CONNECT_COOKIE : CONNECT_COOKIE,
        options: {
            httpOnly: true,
            path: secure ? '/' : '/connect',
            sameSite: 'lax',
            secure,
        },
    }
}
