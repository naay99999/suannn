import { describe, expect, it } from 'bun:test'

describe('commerce maintenance worker lifecycle', () => {
  it('runs a bounded batch and reports a cleanup failure without rejecting its tick', async () => {
    const maintenance = await import('../../src/modules/commerce/maintenance').catch(() => undefined)
    expect(maintenance).toBeDefined()
    if (!maintenance) return

    let requestedLimit = 0
    await maintenance.runCommerceMaintenanceBatch(async (limit) => {
      requestedLimit = limit
      return 0
    })
    expect(requestedLimit).toBe(100)

    let reportedError: unknown
    await expect(maintenance.runCommerceMaintenanceBatch(async () => {
      throw new Error('database unavailable')
    }, (error) => { reportedError = error })).resolves.toBeUndefined()
    expect(reportedError).toMatchObject({ message: 'database unavailable' })
  })

  it('prevents overlapping batches and waits for an in-flight batch when stopped', async () => {
    const maintenance = await import('../../src/modules/commerce/maintenance').catch(() => undefined)
    expect(maintenance).toBeDefined()
    if (!maintenance) return

    let tick: (() => void) | undefined
    let interval = 0
    let cleared = false
    let releaseBatch: (() => void) | undefined
    let calls = 0
    const timer = 1 as unknown as ReturnType<typeof setInterval>
    const scheduler = {
      setInterval(callback: () => void, milliseconds: number) {
        tick = callback
        interval = milliseconds
        return timer
      },
      clearInterval(handle: ReturnType<typeof setInterval>) {
        cleared = handle === timer
      },
    }
    const stop = maintenance.startCommerceMaintenanceLoop(async () => {
      calls += 1
      await new Promise<void>((resolve) => { releaseBatch = resolve })
      return 0
    }, undefined, scheduler)

    expect(interval).toBe(60_000)
    tick?.()
    tick?.()
    await Promise.resolve()
    expect(calls).toBe(1)
    let stopped = false
    const stoppedPromise = stop().then(() => { stopped = true })
    await Promise.resolve()
    expect(cleared).toBe(true)
    expect(stopped).toBe(false)
    releaseBatch?.()
    await stoppedPromise
    expect(stopped).toBe(true)
  })
})
