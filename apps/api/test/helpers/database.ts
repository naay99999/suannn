import { sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { createDatabase } from '../../src/database/client'
import { requireTestDatabaseUrl } from '../require-test-database'

export function createTestDatabase(url = requireTestDatabaseUrl()) {
  return { ...createDatabase(url), url }
}

type TestDatabase = ReturnType<typeof createTestDatabase>

async function assertTestDatabase(database: TestDatabase) {
  const result = await database.db.execute<{ currentDatabase: string }>(
    sql`select current_database() as "currentDatabase"`,
  )
  const currentDatabase = result[0]?.currentDatabase

  if (!currentDatabase?.endsWith('_test')) {
    throw new Error(`Refusing database test operation on ${currentDatabase ?? 'unknown database'}`)
  }
}

export async function resetTestDatabase(database: TestDatabase) {
  await assertTestDatabase(database)
  await database.client.unsafe('drop schema if exists public cascade')
  await database.client.unsafe('drop schema if exists drizzle cascade')
  await database.client.unsafe('create schema public')
}

export async function migrateTestDatabase(database: TestDatabase) {
  await assertTestDatabase(database)
  await migrate(database.db, {
    migrationsFolder: new URL('../../drizzle', import.meta.url).pathname,
  })
}

export async function lockTestDatabase(database: TestDatabase) {
  const connection = await database.client.reserve()
  await connection.unsafe('select pg_advisory_lock(731924681)')

  return async () => {
    await connection.unsafe('select pg_advisory_unlock(731924681)')
    await connection.release()
  }
}
