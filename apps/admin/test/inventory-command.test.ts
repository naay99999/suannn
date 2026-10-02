import { expect, test } from 'bun:test'
const commandModule = await import('../src/lib/inventory/command-attempt').catch(() => null)

test('reuses the immutable attempt for the same command and blocks changed input until known resolution', () => {
  expect(commandModule).not.toBeNull()
  if (!commandModule) return
  const attempt = commandModule.createCommandAttempt<{ quantity: number; metadata: { lotId: string } }>()
  const input = { quantity: 3, metadata: { lotId: 'lot-1' } }
  const original = attempt.prepare('receipt', input)
  input.metadata.lotId = 'lot-2'
  attempt.markUncertain()

  const repeated = attempt.prepare('receipt', { quantity: 3, metadata: { lotId: 'lot-1' } })
  expect(repeated.key).toBe(original.key)
  expect(repeated.payload).toEqual(original.payload)
  expect(Object.isFrozen(repeated.payload.metadata)).toBe(true)
  expect(() => attempt.prepare('receipt', { quantity: 4, metadata: { lotId: 'lot-1' } })).toThrow('UNRESOLVED_COMMAND')

  attempt.complete()
  expect(attempt.prepare('receipt', { quantity: 4, metadata: { lotId: 'lot-1' } }).key).not.toBe(original.key)
})

test('reject clears a known rejected attempt so corrected input receives a new key', () => {
  expect(commandModule).not.toBeNull()
  if (!commandModule) return
  const attempt = commandModule.createCommandAttempt<{ reason: string }>()
  const original = attempt.prepare('quarantine', { reason: 'ตรวจสอบ' })
  attempt.reject()

  expect(attempt.snapshot().state).toBe('idle')
  expect(attempt.prepare('quarantine', { reason: 'ตรวจซ้ำ' }).key).not.toBe(original.key)
})
