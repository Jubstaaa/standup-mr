import { describe, expect, it } from 'bun:test'

import { ConfigError, resolveHost, resolveToken } from './config'

describe('resolveHost', () => {
    it('prefers the explicit argument over env and glab', () => {
        expect(resolveHost('a.com', 'b.com', ['c.com'])).toBe('a.com')
    })

    it('prefers env over glab', () => {
        expect(resolveHost(undefined, 'b.com', ['c.com'])).toBe('b.com')
    })

    it('uses a single glab host', () => {
        expect(resolveHost(undefined, undefined, ['c.com'])).toBe('c.com')
    })

    it('names every candidate when glab has several hosts', () => {
        expect(() => resolveHost(undefined, undefined, ['a.com', 'b.com'])).toThrow(
            /a\.com.*b\.com/
        )
    })

    it('throws when no host is configured anywhere', () => {
        expect(() => resolveHost(undefined, undefined, [])).toThrow(ConfigError)
    })
})

describe('resolveToken', () => {
    it('follows cli, then env, then glab', () => {
        expect(resolveToken('h', 'cli', 'env', () => 'glab')).toBe('cli')
        expect(resolveToken('h', undefined, 'env', () => 'glab')).toBe('env')
        expect(resolveToken('h', undefined, undefined, () => 'glab')).toBe('glab')
    })

    it('names the host when no token is found', () => {
        expect(() => resolveToken('gitlab.example.com', undefined, undefined, () => '')).toThrow(
            /gitlab\.example\.com/
        )
    })

    it('works without glab installed', () => {
        expect(resolveToken('h', undefined, 'env-token', undefined)).toBe('env-token')
    })
})
