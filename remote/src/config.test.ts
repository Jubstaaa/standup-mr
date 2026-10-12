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
