import { CONNECT_COOKIE, SECURE_CONNECT_COOKIE } from './connect.constants'

export function connectCookieName(siteUrl: URL): string {
    return siteUrl.protocol === 'https:'
        ? SECURE_CONNECT_COOKIE
        : CONNECT_COOKIE
}
