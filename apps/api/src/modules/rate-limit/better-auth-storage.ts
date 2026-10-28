import type { BetterAuthRateLimitStorage } from '../../plugins/auth/auth'
import { hashToken } from '../../shared/crypto'
import type { ApplicationRateLimitRepository } from './repository'

// Keys Better Auth counters by namespace so two instances never share a bucket.
export function createBetterAuthRateLimitStorage(
  repository: ApplicationRateLimitRepository,
  namespace: string,
  now: () => Date = () => new Date(),
): BetterAuthRateLimitStorage {
  return {
    async consume(key, rule) {
      const current = now()
      const counter = await repository.consume({
        keyHash: hashToken(`${namespace}:${key}`),
        namespace,
        now: current,
        windowSeconds: rule.window,
      })
      const allowed = counter.count <= rule.max

      return {
        allowed,
        retryAfter: allowed
          ? null
          : Math.max(1, Math.ceil((counter.expiresAt.getTime() - current.getTime()) / 1000)),
      }
    },
  }
}
