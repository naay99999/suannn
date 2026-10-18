import { describe, expect, it } from 'bun:test'
import { CustomerSignupService } from '../../src/modules/auth/customer/service'
import type { AuditService } from '../../src/modules/audit/service'

describe('customer signup limits and failure handling', () => {
  it('stops at the aggregate IP budget before the email budget or identity work', async () => {
    const namespaces: string[] = []
    let identityOperations = 0
    const service = new CustomerSignupService({
      auth: { api: { signUpEmail: async () => { throw new Error('should not provision') } } } as never,
      claims: { withEmailOperation: async () => { identityOperations += 1 } } as never,
      limiter: {
        consume: async ({ namespace }) => {
          namespaces.push(namespace)
          return { allowed: false, remaining: 0, retryAfterSeconds: 60, resetAt: new Date() }
        },
      },
      audit: {} as AuditService,
      dummyPasswordHash: async () => undefined,
    })
    const response = await service.signupCustomer({
      email: 'rotated-email@example.com', password: 'correct horse battery staple',
      name: 'Test', ip: '192.0.2.10',
    })
    expect(response).toEqual({ accepted: true, next: 'sign-in' })
    expect(namespaces).toEqual(['customer-signup-ip'])
    expect(identityOperations).toBe(0)
  })

  it('returns a generic 503 when production cannot resolve a trusted client IP', async () => {
    let limiterCalls = 0
    const service = new CustomerSignupService({
      auth: {} as never,
      claims: {} as never,
      limiter: { consume: async () => { limiterCalls += 1; throw new Error('should not run') } },
      audit: {} as AuditService,
      requireTrustedClientIp: true,
    })
    await expect(service.signupCustomer({
      email: 'private@example.com', password: 'correct horse battery staple',
      name: 'Test', ip: 'unknown',
    })).rejects.toMatchObject({
      code: 'CLIENT_IP_UNAVAILABLE', status: 503, publicMessage: 'Service temporarily unavailable',
    })
    expect(limiterCalls).toBe(0)
  })

  it('reports the store verification policy without depending on the address', async () => {
    const responses = []
    for (const required of [true, false]) {
      const service = new CustomerSignupService({
        auth: {} as never,
        claims: {} as never,
        limiter: { consume: async () => ({ allowed: false, remaining: 0, retryAfterSeconds: 60, resetAt: new Date() }) },
        audit: {} as AuditService,
        emailVerificationRequired: async () => required,
      })
      responses.push(await service.signupCustomer({
        email: 'policy@example.com', password: 'correct horse battery staple', name: 'Test', ip: '192.0.2.10',
      }))
    }
    expect(responses).toEqual([
      { accepted: true, next: 'verify-email' },
      { accepted: true, next: 'sign-in' },
    ])
  })

  it('fails closed with a generic 503 when the verification policy cannot be read', async () => {
    let limiterCalls = 0
    const service = new CustomerSignupService({
      auth: {} as never,
      claims: {} as never,
      limiter: { consume: async () => { limiterCalls += 1; throw new Error('should not run') } },
      audit: {} as AuditService,
      emailVerificationRequired: async () => { throw new Error('database down') },
    })
    await expect(service.signupCustomer({
      email: 'policy@example.com', password: 'correct horse battery staple', name: 'Test', ip: '192.0.2.10',
    })).rejects.toMatchObject({ code: 'IDENTITY_UNAVAILABLE' })
    expect(limiterCalls).toBe(0)
  })
})
