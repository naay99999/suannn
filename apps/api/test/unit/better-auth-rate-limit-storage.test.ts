import { describe, expect, it } from 'bun:test'
import { createBetterAuthRateLimitStorage } from '../../src/modules/rate-limit/better-auth-storage'
import type { ApplicationRateLimitRepository } from '../../src/modules/rate-limit/repository'
import { hashToken } from '../../src/shared/crypto'

function fakeRepository(count: number, expiresAt: Date) {
  const calls: Array<{ keyHash: string; namespace: string; now: Date; windowSeconds: number }> = []
  const repository = {
    consume: async (input: { keyHash: string; namespace: string; now: Date; windowSeconds: number }) => {
      calls.push(input)
      return { count, expiresAt }
    },
  } as unknown as ApplicationRateLimitRepository
  return { repository, calls }
}

describe('Better Auth rate-limit storage', () => {
  it('counts a namespaced key hash over the rule window', async () => {
    const { repository, calls } = fakeRepository(5, new Date(Date.now() + 60_000))
    const storage = createBetterAuthRateLimitStorage(repository, 'staff-auth')

    expect(await storage.consume('127.0.0.1|/sign-in/email', { window: 60, max: 5 }))
      .toEqual({ allowed: true, retryAfter: null })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      keyHash: hashToken('staff-auth:127.0.0.1|/sign-in/email'),
      namespace: 'staff-auth',
      windowSeconds: 60,
    })
  })

  it('refuses past the rule max with seconds until the window ends', async () => {
    const { repository } = fakeRepository(6, new Date(Date.now() + 42_500))
    const storage = createBetterAuthRateLimitStorage(repository, 'staff-auth')

    expect(await storage.consume('key', { window: 60, max: 5 })).toEqual({ allowed: false, retryAfter: 43 })
  })

  it('keeps namespaces apart for the same Better Auth key', async () => {
    const { repository, calls } = fakeRepository(1, new Date(Date.now() + 60_000))
    await createBetterAuthRateLimitStorage(repository, 'staff-auth').consume('key', { window: 60, max: 5 })
    await createBetterAuthRateLimitStorage(repository, 'customer-auth').consume('key', { window: 60, max: 5 })

    expect(calls[0]!.keyHash).not.toBe(calls[1]!.keyHash)
  })
})
