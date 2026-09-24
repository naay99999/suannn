import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

export function createDatabase(databaseUrl: string, options: { max?: number } = {}) {
  const client = postgres(databaseUrl, { max: options.max ?? 10 })
  const db = drizzle({ client, schema })

  return { client, db }
}

export function createIdentityLockPool(databaseUrl: string) {
  return postgres(databaseUrl, {
    max: 9,
    connect_timeout: 10,
    connection: { statement_timeout: 15_000, lock_timeout: 10_000 },
  })
}
