import { describe, expect, it } from 'bun:test'
import {
  COMMERCE_MAINTENANCE_BATCH_SIZE,
  COMMERCE_MAINTENANCE_INTERVAL_MS,
  startCommerceMaintenanceLoop,
} from '../../src/modules/commerce/maintenance'

function makeScheduler() {
  let tick: () => void = () => undefined
  let interval = 0
  let cleared = false
  return {
    scheduler: {
      setInterval(callback: () => void, milliseconds: number) {
        tick = callback
        interval = milliseconds
        return 1 as unknown as ReturnType<typeof setInterval>
      },
      clearInterval() {
        cleared = true
      },
    },
    fire: () => tick(),
    interval: () => interval,
    cleared: () => cleared,
  }
}

describe('Stripe commerce maintenance', () => {
  it('runs bounded batches every minute and does not overlap an in-flight batch', async () => {
    const timer = makeScheduler()
    let release: (() => void) | undefined
    let calls = 0
    const stop = startCommerceMaintenanceLoop(async (limit) => {
      expect(limit).toBe(COMMERCE_MAINTENANCE_BATCH_SIZE)
      calls += 1
      await new Promise<void>((resolve) => { release = resolve })
      return 0
    }, () => undefined, timer.scheduler)

    expect(COMMERCE_MAINTENANCE_INTERVAL_MS).toBe(60_000)
    expect(timer.interval()).toBe(60_000)
    timer.fire()
    timer.fire()
    expect(calls).toBe(1)

    release?.()
    await new Promise((resolve) => setTimeout(resolve, 0))
    timer.fire()
    expect(calls).toBe(2)
    release?.()
    await stop()
  })

  it('stops scheduling and waits for its in-flight batch during shutdown', async () => {
    const timer = makeScheduler()
    let release: (() => void) | undefined
    let calls = 0
    const stop = startCommerceMaintenanceLoop(async () => {
      calls += 1
      await new Promise<void>((resolve) => { release = resolve })
      return 0
    }, () => undefined, timer.scheduler)
    timer.fire()

    let stopped = false
    const shutdown = stop().then(() => { stopped = true })
    await Promise.resolve()
    expect(timer.cleared()).toBe(true)
    expect(stopped).toBe(false)
    timer.fire()
    expect(calls).toBe(1)

    release?.()
    await shutdown
    expect(stopped).toBe(true)
  })
})
