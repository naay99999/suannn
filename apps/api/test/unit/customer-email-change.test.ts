import { describe, expect, it, spyOn } from 'bun:test'
import { hashPassword } from 'better-auth/crypto'
import { CustomerEmailChangeService } from '../../src/modules/customer/email-change/service'
import { digestEmailChangeCode, verifyEmailChangeCode } from '../../src/modules/customer/email-change/code'

const userId = 'customer-1'
const input = {
  userId,
  sessionId: 'session-1',
  currentPassword: 'correct horse battery staple',
  clientIp: '127.0.0.1',
  requestId: 'request-1',
}

async function fixture(failDelivery = false) {
  const sent: Array<{ to: string; text: string; template: string }> = []
  const pending: Array<{ userId: string; newEmail: string; codeDigest: string; expiresAt: Date; failedAttempts: number }> = []
  const background: Promise<unknown>[] = []
  const passwordHash = await hashPassword(input.currentPassword)
  const service = new CustomerEmailChangeService({
    repository: {
      findCredential: async () => ({ email: 'old@example.com', passwordHash }),
      upsertPending: async (_tx, row) => { pending.splice(0, pending.length, row) },
    },
    claims: {
      withEmailClaim: async (email, callback) => callback({
        tx: {} as never,
        normalizedEmail: email,
        claim: email === 'reserved@example.com' ? { state: 'pending_staff' } as never : null,
        user: email === 'taken@example.com' ? { id: 'other' } as never : null,
        claimCustomer: async () => undefined,
      }),
    },
    secret: 'test-secret-with-at-least-32-characters',
    emailSender: { send: async (message) => {
      sent.push(message)
      if (failDelivery) throw new Error('delivery failed for 01234567')
      return { id: 'sent' }
    } },
    runInBackground: (task) => { background.push(task()) },
    now: () => new Date('2026-09-24T12:00:00.000Z'),
    generateCode: () => '01234567',
  })
  return { service, sent, pending, background }
}

describe('customer email change request', () => {
  it('normalizes the new address and sends a code without returning or storing it', async () => {
    const { service, sent, pending } = await fixture()
    const response = await service.request({ ...input, newEmail: ' NEW@Example.com ' })

    expect(response).toEqual({ accepted: true })
    expect(sent[0]?.to).toBe('new@example.com')
    expect(sent[0]?.text).toContain('01234567')
    expect(JSON.stringify(response)).not.toContain('01234567')
    expect(JSON.stringify(pending)).not.toContain('01234567')
    expect(pending[0]).toMatchObject({
      userId,
      newEmail: 'new@example.com',
      failedAttempts: 0,
      expiresAt: new Date('2026-09-24T12:10:00.000Z'),
    })
    expect(verifyEmailChangeCode('test-secret-with-at-least-32-characters', userId, '01234567', pending[0]!.codeDigest)).toBe(true)
  })

  it('rejects an incorrect current password before storing or sending', async () => {
    const { service, sent, pending } = await fixture()
    await expect(service.request({ ...input, newEmail: 'new@example.com', currentPassword: 'wrong password' }))
      .rejects.toThrow('INVALID_CURRENT_PASSWORD')
    expect(sent).toHaveLength(0)
    expect(pending).toHaveLength(0)
  })

  it.each([' OLD@Example.com ', 'taken@example.com', 'reserved@example.com'])(
    'rejects an unavailable address %s', async (newEmail) => {
      const { service, sent, pending } = await fixture()
      await expect(service.request({ ...input, newEmail })).rejects.toThrow('EMAIL_UNAVAILABLE')
      expect(sent).toHaveLength(0)
      expect(pending).toHaveLength(0)
    },
  )

  it('replaces an earlier request and resets the wrong-attempt count', async () => {
    const { service, pending } = await fixture()
    await service.request({ ...input, newEmail: 'first@example.com' })
    pending[0]!.failedAttempts = 4
    await service.request({ ...input, newEmail: 'second@example.com' })
    expect(pending).toHaveLength(1)
    expect(pending[0]).toMatchObject({ newEmail: 'second@example.com', failedAttempts: 0 })
  })

  it('does not leak the code when background delivery fails', async () => {
    const log = spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const { service, background } = await fixture(true)
      const response = await service.request({ ...input, newEmail: 'new@example.com' })
      await Promise.all(background)
      expect(response).toEqual({ accepted: true })
      expect(JSON.stringify(log.mock.calls)).not.toContain('01234567')
    } finally {
      log.mockRestore()
    }
  })

  it('uses a keyed digest bound to the customer', () => {
    const digest = digestEmailChangeCode('secret', userId, '01234567')
    expect(verifyEmailChangeCode('secret', userId, '01234567', digest)).toBe(true)
    expect(verifyEmailChangeCode('secret', 'other', '01234567', digest)).toBe(false)
    expect(verifyEmailChangeCode('secret', userId, '01234568', digest)).toBe(false)
  })
})
