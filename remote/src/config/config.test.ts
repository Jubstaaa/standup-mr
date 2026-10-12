import { describe, expect, test } from 'bun:test'

import { loadConfig } from './config'

const valid = {
    PUBLIC_URL: 'https://standup.example.com',
    ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
}

describe('loadConfig', () => {
    test('applies defaults and leaves unset apps out', () => {
        const config = loadConfig(valid)
        expect(config.port).toBe(3000)
        expect(config.databasePath).toBe('/data/standup.db')
        expect(config.github).toBeUndefined()
        expect(config.blockedAddresses).toEqual([])
        expect(config.gitlabInstances).toEqual([])
    })

    test('reads an app only when both id and secret are set', () => {
        expect(
            loadConfig({ ...valid, GITHUB_CLIENT_ID: 'id' }).github
        ).toBeUndefined()
        expect(
            loadConfig({
                ...valid,
                GITLAB_CLIENT_ID: 'id',
                GITLAB_CLIENT_SECRET: 'secret',
            }).gitlab
        ).toEqual({ clientId: 'id', clientSecret: 'secret' })
    })

    test('reads self-hosted GitLab applications', () => {
        expect(
            loadConfig({
                ...valid,
                GITLAB_INSTANCES:
                    'Git.Example.com:id-1:gloas-1, git.other.org:id-2:gloas-2',
            }).gitlabInstances
        ).toEqual([
            {
                host: 'git.example.com',
                clientId: 'id-1',
                clientSecret: 'gloas-1',
            },
            {
                host: 'git.other.org',
                clientId: 'id-2',
                clientSecret: 'gloas-2',
            },
        ])
    })

    test('rejects a malformed self-hosted entry by host', () => {
        expect(() =>
            loadConfig({
                ...valid,
                GITLAB_INSTANCES: 'git.example.com:only-id',
            })
        ).toThrow(/git.example.com.*host:client_id:secret/)
    })

    test('splits blocked addresses', () => {
        expect(
            loadConfig({ ...valid, BLOCKED_ADDRESSES: '1.2.3.4, ::1,' })
                .blockedAddresses
        ).toEqual(['1.2.3.4', '::1'])
    })

    test('names every invalid variable', () => {
        expect(() =>
            loadConfig({ PUBLIC_URL: 'nope', ENCRYPTION_KEY: 'c2hvcnQ=' })
        ).toThrow(
            /PUBLIC_URL[\s\S]*ENCRYPTION_KEY|ENCRYPTION_KEY[\s\S]*PUBLIC_URL/
        )
    })
})
