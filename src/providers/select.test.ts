import { describe, expect, it } from 'bun:test'

import { ConfigError } from '../config/config'
import { chooseKind, connect } from './select'

const NONE = { gitlab: () => [], github: () => [] }

describe('chooseKind', () => {
    it('obeys the explicit flag', () => {
        expect(chooseKind({ provider: 'github', env: {}, probe: NONE })).toBe('github')
        expect(chooseKind({ provider: 'gitlab', env: {}, probe: NONE })).toBe('gitlab')
    })

    it('obeys the environment variable when no flag is given', () => {
        expect(chooseKind({ env: { STANDUP_PROVIDER: 'github' }, probe: NONE })).toBe('github')
    })

    it('rejects an unknown provider name', () => {
        expect(() => chooseKind({ provider: 'bitbucket', env: {}, probe: NONE })).toThrow(
            /bitbucket/
        )
    })

    it('recognises the two public hosts', () => {
        expect(chooseKind({ host: 'github.com', env: {}, probe: NONE })).toBe('github')
        expect(chooseKind({ host: 'GitLab.com', env: {}, probe: NONE })).toBe('gitlab')
    })

    it('recognises a self-hosted host by name, so existing invocations keep working', () => {
        expect(chooseKind({ host: 'gitlab.example.com', env: {}, probe: NONE })).toBe('gitlab')
        expect(chooseKind({ host: 'github.acme.com', env: {}, probe: NONE })).toBe('github')
    })

    it('lets an explicit host win over ambient environment variables', () => {
        const env = { GITLAB_TOKEN: 'glpat-x' }
        expect(chooseKind({ host: 'github.com', env, probe: NONE })).toBe('github')
    })

    it('lets an explicit host win over STANDUP_PROVIDER', () => {
        const env = { STANDUP_PROVIDER: 'gitlab' }
        expect(chooseKind({ host: 'github.com', env, probe: NONE })).toBe('github')
    })

    it('asks for --provider when the host name says nothing', () => {
        expect(() => chooseKind({ host: 'git.acme.com', env: {}, probe: NONE })).toThrow(
            /--provider/
        )
    })

    it('still reads the environment when the host name says nothing', () => {
        expect(
            chooseKind({ host: 'git.acme.com', env: { GITLAB_TOKEN: 'glpat' }, probe: NONE })
        ).toBe('gitlab')
    })

    it('uses whichever environment pair is configured', () => {
        expect(chooseKind({ env: { GITHUB_TOKEN: 'ghp' }, probe: NONE })).toBe('github')
        expect(chooseKind({ env: { GITLAB_HOST: 'h' }, probe: NONE })).toBe('gitlab')
    })

    it('refuses to guess when both environment pairs are configured', () => {
        const env = { GITHUB_TOKEN: 'ghp', GITLAB_TOKEN: 'glpat' }
        expect(() => chooseKind({ env, probe: NONE })).toThrow(/Both GITHUB_\* and GITLAB_\*/)
    })

    it('falls back to whichever cli is authenticated', () => {
        const onlyGh = { gitlab: () => [], github: () => ['github.com'] }
        const onlyGlab = { gitlab: () => ['gitlab.example.com'], github: () => [] }

        expect(chooseKind({ env: {}, probe: onlyGh })).toBe('github')
        expect(chooseKind({ env: {}, probe: onlyGlab })).toBe('gitlab')
    })

    it('refuses to guess when both clis are authenticated', () => {
        const both = { gitlab: () => ['gitlab.com'], github: () => ['github.com'] }
        expect(() => chooseKind({ env: {}, probe: both })).toThrow(
            /Both gh and glab are authenticated/
        )
    })

    it('explains itself when nothing at all is configured', () => {
        expect(() => chooseKind({ env: {}, probe: NONE })).toThrow(/No provider configured/)
    })

    it('rejects an unknown STANDUP_PROVIDER value and names the variable', () => {
        expect(() =>
            chooseKind({ env: { STANDUP_PROVIDER: 'bitbucket' }, probe: NONE })
        ).toThrow(/STANDUP_PROVIDER/)
    })
})

describe('connect', () => {
    it('builds a github provider on the public host by default', () => {
        const provider = connect({
            provider: 'github',
            token: 'ghp',
            env: {},
            probe: NONE,
        })

        expect(provider.kind).toBe('github')
    })

    it('builds a github provider for an enterprise host', () => {
        const provider = connect({
            provider: 'github',
            host: 'git.acme.com',
            token: 'ghp',
            env: {},
            probe: NONE,
        })

        expect(provider.kind).toBe('github')
    })

    it('builds a gitlab provider', () => {
        const provider = connect({
            provider: 'gitlab',
            host: 'gitlab.example.com',
            token: 'glpat',
            env: {},
            probe: NONE,
        })

        expect(provider.kind).toBe('gitlab')
    })

    it('reports a missing token instead of building a broken provider', () => {
        expect(() =>
            connect({ provider: 'gitlab', host: 'gitlab.example.com', env: {}, probe: NONE })
        ).toThrow(/No token/)
    })
})
