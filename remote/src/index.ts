import { loadConfig } from './config'
import { createApp } from './server'
import { Store } from './store'

const PURGE_INTERVAL_MS = 60 * 60_000

const config = loadConfig()
const store = new Store(config.databasePath, config.encryptionKey)
const app = createApp(config, store)

store.purge(Date.now())
setInterval(() => store.purge(Date.now()), PURGE_INTERVAL_MS).unref()

const server = app.listen(config.port, () => {
    console.error(`standup-mr remote listening on :${config.port}`)
})

function shutdown() {
    server.close(() => {
        store.close()
        process.exit(0)
    })
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
