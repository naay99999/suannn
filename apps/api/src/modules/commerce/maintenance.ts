export const COMMERCE_MAINTENANCE_BATCH_SIZE = 100
export const COMMERCE_MAINTENANCE_INTERVAL_MS = 60_000

interface MaintenanceScheduler {
  setInterval(callback: () => void, milliseconds: number): ReturnType<typeof setInterval>
  clearInterval(timer: ReturnType<typeof setInterval>): void
}

export async function runCommerceMaintenanceBatch(
  processBatch: (limit: number) => Promise<number>,
  onError: (error: unknown) => void = () => undefined,
): Promise<void> {
  try {
    await processBatch(COMMERCE_MAINTENANCE_BATCH_SIZE)
  } catch (error) {
    onError(error)
  }
}

export function startCommerceMaintenanceLoop(
  processBatch: (limit: number) => Promise<number>,
  onError: (error: unknown) => void = () => undefined,
  scheduler: MaintenanceScheduler = globalThis,
): () => Promise<void> {
  let stopped = false
  let running: Promise<void> | undefined
  const timer = scheduler.setInterval(() => {
    if (stopped || running) return
    running = runCommerceMaintenanceBatch(processBatch, onError).finally(() => {
      running = undefined
    })
  }, COMMERCE_MAINTENANCE_INTERVAL_MS)
  if (timer && typeof timer === 'object' && 'unref' in timer) {
    (timer as { unref?: () => void }).unref?.()
  }

  return async () => {
    stopped = true
    scheduler.clearInterval(timer)
    await running
  }
}
