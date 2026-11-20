import { describe, expect, test } from 'bun:test'

import { identifyClient } from './client-identity'

describe('identifyClient', () => {
    test.each([
        ['Claude', 'https://claude.ai/api/mcp/auth_callback'],
        ['Claude Code', 'http://localhost:33418/callback'],
        ['Cursor', 'cursor://anysphere.cursor-retrieval/oauth/callback'],
        ['Smithery', 'https://connect.smithery.ai/oauth/callback'],
        ['ChatGPT', 'https://chatgpt.com/connector_platform_oauth_redirect'],
        ['VS Code', 'https://vscode.dev/redirect'],
        ['Claude', 'https://claude.com/api/mcp/auth_callback?x=1'],
    ])('trusts %s redirecting to its own host', (name, redirect) => {
        const identity = identifyClient(name, redirect)
        expect(identity.isRecognized).toBe(true)
        expect(identity.name).toBe(name)
    })

    test('hides a borrowed name behind an unrecognized redirect', () => {
        const identity = identifyClient(
            'Claude',
            'https://attacker-alpha.example.com/cb'
        )
        expect(identity.isRecognized).toBe(false)
        expect(identity.name).toBe('An unrecognized app')
        expect(identity.redirectHost).toBe('attacker-alpha.example.com')
    })

    test('keeps an honest name but still marks it unrecognized', () => {
        const identity = identifyClient(
            'My internal bot',
            'https://bot.example.com/cb'
        )
        expect(identity.isRecognized).toBe(false)
        expect(identity.name).toBe('My internal bot')
    })

    test('does not trust a lookalike host', () => {
        expect(
            identifyClient('Claude', 'https://claude.ai.evil.example/cb')
                .isRecognized
        ).toBe(false)
        expect(
            identifyClient('Claude', 'http://claude.ai/cb').isRecognized
        ).toBe(false)
    })

    test.each([
        // Anyone can publish a custom GPT and pick its callback path.
        'https://chatgpt.com/aip/g-0123456789abcdef/oauth/callback',
        'https://claude.ai/share/some-page',
        'https://claude.ai/api/mcp/auth_callback_evil',
        'https://user-space.smithery.ai/oauth/callback',
        'https://vscode.dev/github/someone/repo',
    ])('does not trust another path on a shared host: %s', redirect => {
        expect(identifyClient('Claude', redirect).isRecognized).toBe(false)
    })
})
