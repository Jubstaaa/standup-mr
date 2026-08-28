import { describe, expect, it } from 'bun:test'

import type { Provider } from '../src/providers/base/base.types'
import { collect } from './server'

const fakeProvider: Provider = {
    kind: 'gitlab',
    getIdentity: async () => ({ id: 1, username: 'dev' }),
    getEvents: async () => [],
    getMyMrs: async () => [],
    getReviews: async () => [],
    getBlockers: async () => [],
}

describe('collect', () => {
    it('builds a report from an injected provider', async () => {
        const report = await collect({ provider: fakeProvider })

        expect(report.user).toBe('dev')
        expect(report).toHaveProperty('reviewPendingCount')
        expect(report.today.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })

    it('passes the language through', async () => {
        const en = await collect({ provider: fakeProvider, lang: 'en' })
        const tr = await collect({ provider: fakeProvider, lang: 'tr' })

        expect(en.today.label).not.toBe(tr.today.label)
    })
})
