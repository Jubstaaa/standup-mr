import { loadConfig } from './config/config'
import { startScheduler } from './schedule/schedule'
import { listen, shutdown } from './server/lifecycle'
import { createApp, createServices } from './server/server'
import { Store } from './store/store'

const PURGE_INTERVAL_MS = 60 * 60_000
// Below the 10 s Docker gives a container between SIGTERM and SIGKILL.
const SHUTDOWN_TIMEOUT_MS = 8_000

const config = loadConfig()
const store = new Store(config.databasePath, config.encryptionKey)
const services = createServices(config, store)
const app = createApp(config, store, services)

store.purge(Date.now())
setInterval(() => store.purge(Date.now()), PURGE_INTERVAL_MS).unref()
const stopScheduler = startScheduler({ ...services, store })

const exit = (code: number) => process.exit(code)
const server = listen(app, config.port, exit)

let stopping = false
function stop() {
    if (stopping) return
    stopping = true
    void shutdown({
        server,
        stopScheduler,
        closeStore: () => store.close(),
        exit,
        timeoutMs: SHUTDOWN_TIMEOUT_MS,
    })
}

process.on('SIGTERM', stop)
process.on('SIGINT', stop)
