import { createApp } from './app'
import { loadConfig } from './config/env'
import { createDatabase } from './database/client'
import { createAuth } from './plugins/auth/auth'

const config = loadConfig()
const database = createDatabase(config.databaseUrl)
const auth = createAuth(config, database.db)
const app = createApp(config, auth)

app.listen({ hostname: config.host, port: config.port })

console.log(
  `API running at http://${app.server?.hostname}:${app.server?.port}`,
)

let isShuttingDown = false

async function shutdown(signal: string) {
  if (isShuttingDown) {
    return
  }

  isShuttingDown = true
  console.info(JSON.stringify({ level: 'info', event: 'shutdown', signal }))
  await app.stop()
  await database.client.end()
  process.exit(0)
}

process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))
