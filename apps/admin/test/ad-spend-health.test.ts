import { expect, test } from 'bun:test'
import { adSpendHealth, HOUR_MS } from '../src/lib/integrations/health'

const now = Date.parse('2026-10-22T12:00:00Z')
const row = (lastSuccessHoursAgo: number | null, lastRunStatus: 'succeeded' | 'failed' | 'running' | null) => ({
  platform: 'meta',
  configured: true,
  lastSuccessAt: lastSuccessHoursAgo === null ? null : new Date(now - lastSuccessHoursAgo * HOUR_MS).toISOString(),
  lastRunStatus,
  lastErrorCode: null,
  earliestDate: null,
}) as Parameters<typeof adSpendHealth>[0]

test('stale or missing success is failing even when the last run succeeded or is running', () => {
  expect(adSpendHealth(row(7, 'succeeded'), now).label).toBe('Failing')
  expect(adSpendHealth(row(7, 'running'), now).label).toBe('Failing')
  expect(adSpendHealth(row(null, 'running'), now).label).toBe('Failing')
})

test('fresh success is healthy, or degraded when the last run failed', () => {
  expect(adSpendHealth(row(1, 'succeeded'), now).label).toBe('Healthy')
  expect(adSpendHealth(row(1, 'running'), now).label).toBe('Healthy')
  expect(adSpendHealth(row(1, 'failed'), now).label).toBe('Degraded')
})

test('unconfigured platform is not configured', () => {
  expect(adSpendHealth({ ...row(null, null), configured: false }, now).label).toBe('Not configured')
})
