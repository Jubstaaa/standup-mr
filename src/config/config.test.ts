import { describe, expect, it } from 'bun:test'

import {
    ConfigError,
    GITHUB_LABELS,
    parseGlabHosts,
    parseLoggedInHosts,
    resolveHost,
    resolveToken,
} from './config'

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

describe('parseGlabHosts', () => {
    it('returns only hosts that are actually logged in', () => {
        const status = [
            'gitlab.com',
            '  x gitlab.com: API call failed: 401',
            'gitlab.example.com',
            '  ✓ Logged in to gitlab.example.com as dev (/path/config.yml)',
        ].join('\n')

        expect(parseGlabHosts(status)).toEqual(['gitlab.example.com'])
    })

    it('returns several hosts sorted and de-duplicated', () => {
        const status = [
            '  ✓ Logged in to b.example.com as dev',
            '  ✓ Logged in to a.example.com as dev',
            '  ✓ Logged in to b.example.com as dev',
        ].join('\n')

        expect(parseGlabHosts(status)).toEqual(['a.example.com', 'b.example.com'])
    })

    it('returns nothing when no host is logged in', () => {
        expect(parseGlabHosts('gitlab.com\n  x gitlab.com: API call failed: 401\n')).toEqual([])
    })
})

describe('resolveHost with github labels', () => {
    it('names the github env var when nothing is configured', () => {
        expect(() => resolveHost(undefined, undefined, [], GITHUB_LABELS)).toThrow(
            /GITHUB_HOST/
        )
    })

    it('points at the gh cli, not glab', () => {
        expect(() => resolveHost(undefined, undefined, [], GITHUB_LABELS)).toThrow(
            /gh auth login/
        )
    })

    it('names GitHub when several hosts are logged in', () => {
        expect(() =>
            resolveHost(undefined, undefined, ['a.com', 'b.com'], GITHUB_LABELS)
        ).toThrow(/GitHub/)
    })
})

describe('resolveToken with github labels', () => {
    it('points at gh auth login for the given host', () => {
        expect(() =>
            resolveToken('github.com', undefined, undefined, () => '', GITHUB_LABELS)
        ).toThrow(/gh auth login --hostname github\.com/)
    })
})

describe('parseLoggedInHosts', () => {
    it('reads the gh auth status wording', () => {
        const status = [
            'github.com',
            '  ✓ Logged in to github.com account dev (keyring)',
            '  - Active account: true',
        ].join('\n')

        expect(parseLoggedInHosts(status)).toEqual(['github.com'])
    })

    it('reads the glab auth status wording', () => {
        expect(
            parseLoggedInHosts('  ✓ Logged in to gitlab.example.com as dev (/p/c.yml)')
        ).toEqual(['gitlab.example.com'])
    })

    it('returns nothing when gh is not logged in', () => {
        expect(
            parseLoggedInHosts(
                'You are not logged into any GitHub hosts. To log in, run: gh auth login'
            )
        ).toEqual([])
    })

    it('is what parseGlabHosts resolves to', () => {
        expect(parseGlabHosts('  ✓ Logged in to h as dev')).toEqual(['h'])
    })
})
