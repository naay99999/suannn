import { createAuth } from './auth'
import { loadConfig } from '../../config/env'
import { createDatabase } from '../../database/client'

const config = loadConfig()
const database = createDatabase(config.databaseUrl)

export const auth = createAuth(config, database.db)
