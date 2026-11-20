import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it } from 'bun:test'
import { z } from 'zod'

import { createStandupServer, text } from './mcp-tools'
import type { StandupServerTools } from './mcp-tools'

const repoRoot = join(import.meta.dir, '..', '..')

async function connected(tools: StandupServerTools) {
    const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair()
    await createStandupServer(tools).connect(serverTransport)
    const client = new Client({ name: 'test', version: '0.0.0' })
    await client.connect(clientTransport)
    return client
}

function recordingTools(calls: unknown[]): StandupServerTools {
    return {
        standup: {
            description: 'standup description',
            inputSchema: { lang: z.string().optional() },
            run: async args => {
                calls.push(['standup', args])
                return text('report')
            },
        },
        post: {
            description: 'post description',
            inputSchema: { text: z.string() },
            run: async args => {
                calls.push(['post', args])
                return text('posted')
            },
        },
    }
}

describe('createStandupServer', () => {
    it('registers the three tools with the caller descriptions', async () => {
        const client = await connected(recordingTools([]))

        const { tools } = await client.listTools()
        const descriptions = Object.fromEntries(
            tools.map(tool => [tool.name, tool.description])
        )

        expect(descriptions.get_standup_data).toBe('standup description')
        expect(descriptions.post_standup_note).toBe('post description')
        expect(descriptions.get_note_instructions).toMatch(/rules/)
        await client.close()
    })

    it('routes each tool call to its handler with the parsed arguments', async () => {
        const calls: unknown[] = []
        const client = await connected(recordingTools(calls))

        await client.callTool({
            name: 'get_standup_data',
            arguments: { lang: 'tr' },
        })
        await client.callTool({
            name: 'post_standup_note',
            arguments: { text: 'note' },
        })

        expect(calls).toEqual([
            ['standup', { lang: 'tr' }],
            ['post', { text: 'note' }],
        ])
        await client.close()
    })

    it('serves the note-writing rules and the standup prompt', async () => {
        const client = await connected(recordingTools([]))

        const rules = await client.callTool({ name: 'get_note_instructions' })
        const { prompts } = await client.listPrompts()

        expect(JSON.stringify(rules.content)).toContain('# Standup Note')
        expect(prompts.map(prompt => prompt.name)).toEqual(['standup'])
        await client.close()
    })

    it('reports the published package version', async () => {
        const client = await connected(recordingTools([]))

        expect(client.getServerVersion()).toMatchObject({
            name: 'standup-mr',
            version: JSON.parse(
                readFileSync(join(repoRoot, 'package.json'), 'utf8')
            ).version,
        })
        await client.close()
    })
})
