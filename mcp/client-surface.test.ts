import { randomBytes } from 'node:crypto'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { expect, test } from 'bun:test'

import { createTokenRefresher } from '../remote/src/accounts/accounts'
import { Store } from '../remote/src/store/store'
import { createRemoteServer } from '../remote/src/tools/tools'

import { createServer } from './server'

// What an MCP client is shown: names, titles, descriptions, hints, argument
// keys and prompts. Both servers are pinned so a shared-code change cannot
// alter either surface unnoticed.
async function clientSurface(server: McpServer) {
    const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    const client = new Client({ name: 'surface', version: '0.0.0' })
    await client.connect(clientTransport)

    const { tools } = await client.listTools()
    const { prompts } = await client.listPrompts()
    await client.close()

    return {
        tools: tools
            .map(tool => ({
                name: tool.name,
                title: tool.title,
                description: tool.description,
                annotations: tool.annotations,
                inputKeys: Object.keys(
                    tool.inputSchema.properties ?? {}
                ).sort(),
                required: tool.inputSchema.required ?? [],
            }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        prompts,
    }
}

test('the local stdio server shows clients the same surface', async () => {
    expect(await clientSurface(createServer())).toMatchSnapshot()
})

test('the remote connector shows clients the same surface', async () => {
    const store = new Store(':memory:', randomBytes(32))
    const server = createRemoteServer({
        connectionId: 'surface',
        fetchImpl: async () => new Response('ok'),
        freshAccessToken: createTokenRefresher(
            { resolve: () => undefined, refresh: () => Promise.reject() },
            store.accounts
        ),
        now: () => 0,
        store,
    })

    expect(await clientSurface(server)).toMatchSnapshot()
})
