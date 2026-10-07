import { describe, expect, it } from 'bun:test'
import { drainShutdown } from '../../src/shared/shutdown'
import { startCommerceMaintenanceLoop } from '../../src/modules/commerce/maintenance'
import { startInventoryMaintenanceLoop } from '../../src/modules/inventory/maintenance'
import { EmailTaskQueue } from '../../src/modules/email/sender'

const delay = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds))

describe('API shutdown deadline', () => {
  it('leaves time for both pools to finish forced destruction before shutdown returns', async () => {
    const closed: string[] = []
    const pools = ['identity', 'database'].map(name => ({ name, run: async (timeoutMs: number) => {
      // Postgres registers its destruction timer after an asynchronous yield.
      await Promise.resolve()
      await new Promise<void>(resolve => setTimeout(() => { closed.push(name); resolve() }, timeoutMs))
    } }))
    expect(await drainShutdown({ timeoutMs: 80, producers: [], consumers: [], pools, onIssue: () => {} })).toBe(true)
    expect(closed).toEqual(['identity', 'database'])
  })

  it('stops real workers from scheduling while a stuck batch and email drain time out', async () => {
    const ticks: Array<() => void> = []
    let cleared = 0
    const scheduler = {
      setInterval(callback: () => void) {
        ticks.push(callback)
        return ticks.length as unknown as ReturnType<typeof setInterval>
      },
      clearInterval() { cleared += 1 },
    }
    let batches = 0
    const stuckBatch = async () => { batches += 1; await new Promise<void>(() => {}); return 0 }
    const stopCommerce = startCommerceMaintenanceLoop(stuckBatch, undefined, scheduler)
    const stopInventory = startInventoryMaintenanceLoop(stuckBatch, undefined, scheduler)
    ticks.forEach(tick => tick())
    const queue = new EmailTaskQueue()
    queue.enqueue(() => new Promise<void>(() => {}))
    const issues: string[] = []
    let closed = 0
    expect(await drainShutdown({ timeoutMs: 50,
      producers: [{ name: 'commerce', run: stopCommerce }, { name: 'inventory', run: stopInventory }],
      consumers: [{ name: 'email', run: remainingMs => queue.drain(remainingMs) }],
      pools: ['identity', 'database'].map(name => ({ name, run: async () => { closed += 1 } })),
      onIssue: issue => issues.push(issue.stage),
    })).toBe(false)
    ticks.forEach(tick => tick())
    expect(cleared).toBe(2)
    expect(batches).toBe(2)
    expect(closed).toBe(2)
    expect(issues.sort()).toEqual(['commerce', 'email', 'inventory'])
  })

  it('bounds stuck listener, maintenance, email, background work and pool closes by one budget', async () => {
    const issues: string[] = []
    const closed: string[] = []
    const never = () => new Promise<void>(() => {})
    const started = performance.now()
    const drained = await drainShutdown({
      timeoutMs: 80,
      producers: ['listener', 'inventory', 'commerce'].map(name => ({ name, run: never })),
      consumers: ['email', 'background'].map(name => ({ name, run: never })),
      pools: ['identity-pool', 'database-pool'].map(name => ({ name, run: async (remainingMs: number) => {
        expect(remainingMs).toBeGreaterThan(0)
        closed.push(name)
        await never()
      } })),
      onIssue: issue => issues.push(`${issue.stage}:${issue.reason}`),
    })
    expect(drained).toBe(false)
    expect(performance.now() - started).toBeLessThan(200)
    expect(closed).toEqual(['identity-pool', 'database-pool'])
    expect(issues.sort()).toEqual(['background:timeout', 'commerce:timeout', 'database-pool:timeout', 'email:timeout', 'identity-pool:timeout', 'inventory:timeout', 'listener:timeout'])
  })

  it('finishes producers before draining consumers and closes both pools after a rejected stage', async () => {
    let producerFinished = false
    let consumerFinished = false
    const closed: string[] = []
    const issues: unknown[] = []
    expect(await drainShutdown({
      timeoutMs: 200,
      producers: [{ name: 'listener', run: async () => { await delay(5); producerFinished = true } }],
      consumers: [{ name: 'email', run: async () => { expect(producerFinished).toBe(true); consumerFinished = true; throw new Error('provider failed') } }],
      pools: ['identity-pool', 'database-pool'].map(name => ({ name, run: async () => { expect(consumerFinished).toBe(true); closed.push(name) } })),
      onIssue: issue => issues.push(issue),
    })).toBe(false)
    expect(closed).toEqual(['identity-pool', 'database-pool'])
    expect(issues).toEqual([{ stage: 'email', reason: 'error', errorCategory: 'Error' }])
  })

  it('allows a delayed batch and queued work to complete within the budget', async () => {
    const issues: unknown[] = []
    expect(await drainShutdown({ timeoutMs: 200,
      producers: [{ name: 'commerce', run: () => delay(5) }],
      consumers: [{ name: 'email', run: async () => true }],
      pools: [{ name: 'database-pool', run: async () => {} }], onIssue: issue => issues.push(issue),
    })).toBe(true)
    expect(issues).toEqual([])
  })
})
