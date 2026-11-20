import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { connect } from 'node:net'

import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import express from 'express'

import { listen, shutdown } from './lifecycle'

const servers: Server[] = []

afterEach(() => {
    for (const server of servers.splice(0)) {
        server.closeAllConnections()
        server.close()
    }
})

function occupiedPort(): Promise<number> {
    const holder = createServer()
    servers.push(holder)
    return new Promise(resolve => {
        holder.listen(0, () => {
            const address = holder.address()
            resolve(typeof address === 'object' && address ? address.port : 0)
        })
    })
}

describe('listen', () => {
    test('exits with 1 when the port cannot be bound', async () => {
        const port = await occupiedPort()
        const logged = spyOn(console, 'error').mockImplementation(() => {})
        try {
            const code = await new Promise<number>(resolve => {
                servers.push(listen(express(), port, resolve))
            })
            expect(code).toBe(1)
            expect(String(logged.mock.calls[0])).toContain(String(port))
        } finally {
            logged.mockRestore()
        }
    })
})

describe('shutdown', () => {
    function started(): Promise<Server> {
        return new Promise(resolve => {
            const server = express().listen(0, '127.0.0.1', () =>
                resolve(server)
            )
            servers.push(server)
        })
    }

    test('stops the scheduler, closes the server and the store, exits 0', async () => {
        const server = await started()
        const order: string[] = []
        const code = await new Promise<number>(resolve => {
            void shutdown({
                server,
                stopScheduler: async () => {
                    order.push('scheduler')
                },
                closeStore: () => order.push('store'),
                exit: resolve,
                timeoutMs: 1_000,
            })
        })
        expect(code).toBe(0)
        expect(order).toEqual(['scheduler', 'store'])
        expect(server.listening).toBe(false)
    })

    test('forces the exit when closing hangs', async () => {
        const server = await started()
        const address = server.address()
        // An idle keep-alive client keeps server.close() from finishing.
        const socket = connect(
            typeof address === 'object' && address ? address.port : 0,
            '127.0.0.1'
        )
        await new Promise(resolve => socket.on('connect', resolve))
        const logged = spyOn(console, 'error').mockImplementation(() => {})
        try {
            const code = await new Promise<number>(resolve => {
                void shutdown({
                    server,
                    stopScheduler: () => new Promise<void>(() => {}),
                    closeStore: () => {},
                    exit: resolve,
                    timeoutMs: 50,
                })
            })
            expect(code).toBe(1)
        } finally {
            logged.mockRestore()
            socket.destroy()
        }
    })

    test('exits 1 and logs when a step of the shutdown throws', async () => {
        const server = await started()
        const logged = spyOn(console, 'error').mockImplementation(() => {})
        try {
            const code = await new Promise<number>(resolve => {
                void shutdown({
                    server,
                    stopScheduler: async () => {},
                    closeStore: () => {
                        throw new Error('database is locked')
                    },
                    exit: resolve,
                    timeoutMs: 1_000,
                })
            })
            expect(code).toBe(1)
            expect(logged.mock.calls.flat().join(' ')).toContain(
                'database is locked'
            )
        } finally {
            logged.mockRestore()
        }
    })
})
