import { afterEach, describe, expect, it, spyOn } from 'bun:test'

import { collect } from './tools'

afterEach(() => {
    spyOn(globalThis, 'fetch').mockRestore()
})

describe('collect warnings', () => {
    it('returns an empty GitHub events feed warning in the report', async () => {
        spyOn(globalThis, 'fetch').mockImplementation((async (url: unknown) => {
            const target = String(url)
            if (target.endsWith('/user')) {
                return new Response(JSON.stringify({ id: 1, login: 'dev' }))
            }
            if (target.includes('search/issues')) {
                return new Response(JSON.stringify({ items: [] }))
            }
            return new Response('[]')
        }) as typeof fetch)

        const report = await collect({
            provider: 'github',
            host: 'github.com',
            token: 't',
        })

        expect(report.warnings.join('')).toMatch(/events feed/)
    })
})
