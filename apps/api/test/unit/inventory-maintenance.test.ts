import { describe, expect, it } from 'bun:test'
import {
  INVENTORY_MAINTENANCE_INTERVAL_MS,
  runInventoryMaintenanceBatch,
  startInventoryMaintenanceLoop,
} from '../../src/modules/inventory/maintenance'

describe('inventory maintenance', () => {
  it('requests a bounded expiry batch', async () => {
    let requestedLimit = 0
    await runInventoryMaintenanceBatch(async (limit) => {
      requestedLimit = limit
      return 0
    })

    expect(requestedLimit).toBe(100)
  })

  it('reports cleanup failures without rejecting the maintenance tick', async () => {
    let reportedError: unknown
    await expect(runInventoryMaintenanceBatch(async () => {
      throw new Error('database unavailable')
    }, (error) => {
      reportedError = error
    })).resolves.toBeUndefined()

    expect(reportedError).toMatchObject({ message: 'database unavailable' })
  })

  it('schedules one bounded cleanup per minute and stops cleanly', async () => {
    let tick: (() => void) | undefined
    let interval = 0
    let cleared = false
    let calls = 0
    const timer = 1 as unknown as ReturnType<typeof setInterval>
    const scheduler = {
      setInterval(callback: () => void, milliseconds?: number) {
        tick = callback
        interval = milliseconds ?? 0
        return timer
      },
      clearInterval(handle: ReturnType<typeof setInterval>) {
        cleared = handle === timer
      },
    }
    const stop = startInventoryMaintenanceLoop(async (limit) => {
      calls += 1
      expect(limit).toBe(100)
      return 0
    }, undefined, scheduler)

    expect(interval).toBe(INVENTORY_MAINTENANCE_INTERVAL_MS)
    tick?.()
    await stop()

    expect(calls).toBe(1)
    expect(cleared).toBe(true)
  })
})
