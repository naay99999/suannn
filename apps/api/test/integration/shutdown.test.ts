import { expect, it } from 'bun:test'
import { createDatabase, createIdentityLockPool } from '../../src/database/client'
import { drainShutdown } from '../../src/shared/shutdown'
import { requireTestDatabaseUrl } from '../require-test-database'

it('finishes closing both real Postgres pools with active queries before the shutdown deadline', async () => {
  const url = requireTestDatabaseUrl()
  const database = createDatabase(url)
  const identity = createIdentityLockPool(url)
  try {
    for (const pool of [identity, database.client]) {
      const result = await pool<{ name: string }[]>`select current_database() as name`
      expect(result[0]?.name.endsWith('_test')).toBe(true)
    }
    const pending = [identity, database.client].map(pool => pool`select pg_sleep(10)`
      .then(() => 'completed', (error: { code: string }) => error.code))
    const closed: string[] = []
    const issues: unknown[] = []
    const started = performance.now()
    expect(await drainShutdown({ timeoutMs: 500, producers: [], consumers: [],
      pools: [
        { name: 'identity', run: async timeoutMs => { await identity.end({ timeout: timeoutMs / 1000 }); closed.push('identity') } },
        { name: 'database', run: async timeoutMs => { await database.client.end({ timeout: timeoutMs / 1000 }); closed.push('database') } },
      ], onIssue: issue => issues.push(issue),
    })).toBe(true)
    expect(performance.now() - started).toBeLessThan(750)
    expect(closed.sort()).toEqual(['database', 'identity'])
    expect(await Promise.all(pending)).toEqual(['CONNECTION_DESTROYED', 'CONNECTION_DESTROYED'])
    expect(issues).toEqual([])
  } finally {
    await Promise.all([identity.end({ timeout: 0 }), database.client.end({ timeout: 0 })])
  }
})
