interface ShutdownStage {
  name: string
  run: (remainingMs: number) => Promise<unknown>
}

interface ShutdownIssue {
  stage: string
  reason: 'timeout' | 'error'
  errorCategory?: string
}

// A deadline limits waiting, not the underlying operation. Durable outbox and
// reconciliation work remains eligible for recovery by the next process.
export async function drainShutdown(options: {
  timeoutMs: number
  producers: ShutdownStage[]
  consumers: ShutdownStage[]
  pools: ShutdownStage[]
  onIssue: (issue: ShutdownIssue) => void
}): Promise<boolean> {
  const deadline = performance.now() + options.timeoutMs
  const drainDeadline = deadline - Math.min(5_000, options.timeoutMs * 0.2)

  async function runStage(stage: ShutdownStage, stageDeadline: number, forceClose = false) {
    const remainingMs = Math.max(0, stageDeadline - performance.now())
    let timer: ReturnType<typeof setTimeout> | undefined
    // Pool destruction must run before our outer timer/process exit. Postgres
    // registers its own timeout asynchronously, so equal deadlines race.
    const operationBudgetMs = forceClose ? remainingMs * 0.8 : remainingMs
    const work = Promise.resolve().then(() => stage.run(operationBudgetMs)).then(result => {
      if (result === false) return 'timeout' as const
      return 'complete' as const
    }).catch((error: unknown) => {
      return { errorCategory: error instanceof Error ? error.name : 'UnknownError' }
    })
    const result = await Promise.race([
      work,
      new Promise<'timeout'>(resolve => { timer = setTimeout(() => resolve('timeout'), remainingMs) }),
    ])
    clearTimeout(timer)
    if (result === 'complete') return true
    options.onIssue(typeof result === 'object'
      ? { stage: stage.name, reason: 'error', ...result }
      : { stage: stage.name, reason: 'timeout' })
    return false
  }

  const producers = await Promise.all(options.producers.map(stage => runStage(stage, drainDeadline)))
  const consumers = await Promise.all(options.consumers.map(stage => runStage(stage, drainDeadline)))
  // Start both closes even if an earlier stage failed or never settled.
  const pools = await Promise.all(options.pools.map(stage => runStage(stage, deadline, true)))
  return [...producers, ...consumers, ...pools].every(Boolean)
}
