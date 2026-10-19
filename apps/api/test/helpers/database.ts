import { sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { createDatabase } from '../../src/database/client'
import { requireTestDatabaseUrl } from '../require-test-database'

export function createTestDatabase(url = requireTestDatabaseUrl(), max = 10) {
  return { ...createDatabase(url, { max }), url }
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

// Mirrors MediaRepository.updateAlt on a second connection: locks the media row, clears its alt,
// and keeps the transaction open until `commit`, so a test can interleave a concurrent writer.
export async function clearMediaAltInOpenTransaction(database: TestDatabase, mediaId: string) {
  const connection = await database.client.reserve()
  await connection.unsafe('begin')
  await connection`select id from media_asset where id = ${mediaId} for update`
  await connection`update media_asset set alt = null where id = ${mediaId}`

  return {
    // True once another backend is queued behind this transaction's row lock.
    async waitForBlockedWriter(timeoutMs = 2000) {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        const [row] = await database.client<{ waiting: number }[]>`
          select count(*)::int as waiting from pg_stat_activity
          where datname = current_database() and wait_event_type = 'Lock'
            and wait_event in ('transactionid', 'tuple')`
        if ((row?.waiting ?? 0) > 0) return true
        await new Promise(resolve => setTimeout(resolve, 20))
      }
      return false
    },
    async commit() {
      await connection.unsafe('commit')
      connection.release()
    },
  }
}
