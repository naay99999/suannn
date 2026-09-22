import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema/auth'

export function createDatabase(databaseUrl: string) {
  const client = postgres(databaseUrl)
  const db = drizzle({ client, schema })

  return { client, db }
}
