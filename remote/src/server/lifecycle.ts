import type { Server } from 'node:http'

import type { Express } from 'express'

import { errorMessage } from '../errors/errors'

export interface ShutdownDeps {
    closeStore: () => void
    exit: (code: number) => void
    server: Server
    stopScheduler: () => Promise<void>
    timeoutMs: number
}

// A port that cannot be bound must end the process with a failure, or the
// container keeps running without serving anything and reports success.
export function listen(
    app: Express,
    port: number,
    exit: (code: number) => void
): Server {
    const server = app.listen(port, error => {
        if (error) {
            console.error(
                `standup-mr remote could not listen on :${port}: ${errorMessage(error)}`
            )
            exit(1)
            return
        }
        console.error(`standup-mr remote listening on :${port}`)
    })
    return server
}

// Stops taking requests and lets a scheduled run finish before the
// database closes under it. A shutdown that hangs (a stuck run, a client
// holding a connection open) is cut off so the orchestrator is not left
// waiting for its own kill timeout.
export async function shutdown(deps: ShutdownDeps): Promise<void> {
    const forced = setTimeout(() => {
        console.error(
            `shutdown did not finish within ${deps.timeoutMs} ms; exiting`
        )
        deps.exit(1)
    }, deps.timeoutMs)
    forced.unref()
    const serverClosed = new Promise<void>(resolve => {
        deps.server.close(() => resolve())
        deps.server.closeIdleConnections()
    })
    try {
        await deps.stopScheduler()
        await serverClosed
        deps.closeStore()
    } catch (error) {
        // Exiting 0 here would tell the orchestrator a clean stop happened
        // while the database may not have been closed.
        console.error(`shutdown failed: ${errorMessage(error)}`)
        clearTimeout(forced)
        deps.exit(1)
        return
    }
    clearTimeout(forced)
    deps.exit(0)
}
