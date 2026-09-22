import { hashToken } from '../../shared/crypto'
import type { ApplicationRateLimitRepository } from './repository'

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  retryAfterSeconds: number
  resetAt: Date
}

export class RateLimiter {
  constructor(
    private readonly repository: ApplicationRateLimitRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async consume(input: {
    namespace: string
    subjectHash: string
    ip: string
    limit: number
    windowSeconds: number
  }): Promise<RateLimitResult> {
    const now = this.now()
    const keyHash = hashToken(`${input.namespace}:${input.subjectHash}:${input.ip}`)
    const counter = await this.repository.consume({
      keyHash,
      namespace: input.namespace,
      now,
      windowSeconds: input.windowSeconds,
    })
    const allowed = counter.count <= input.limit

    return {
      allowed,
      remaining: Math.max(0, input.limit - counter.count),
      retryAfterSeconds: allowed
        ? 0
        : Math.max(1, Math.ceil((counter.expiresAt.getTime() - now.getTime()) / 1000)),
      resetAt: counter.expiresAt,
    }
  }
}

export function rateLimitResponse(result: RateLimitResult) {
  return {
    status: 429 as const,
    headers: {
      'Retry-After': String(result.retryAfterSeconds),
    },
    body: {
      code: 'RATE_LIMITED',
      message: 'Too many requests',
    },
  }
}
