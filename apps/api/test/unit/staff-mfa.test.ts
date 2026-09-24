import { describe, expect, it } from 'bun:test'
import type { Auth } from '../../src/plugins/auth/auth'
import { StaffMfaService } from '../../src/modules/auth/mfa/service'

const now = new Date('2026-09-22T10:00:00.000Z')
const restrictedSession = {
  session: { id: 'session-1', expiresAt: new Date('2026-10-22T10:00:00Z') },
  user: {
    id: 'staff-1',
    name: 'Staff',
    email: 'staff@example.com',
    emailVerified: true,
    image: null,
    accountType: 'staff' as const,
  },
}
const activeSession = {
  ...restrictedSession,
  staff: { role: 'support' as const, permissions: ['order:read'] },
}

function createHarness(current: typeof restrictedSession | typeof activeSession | null) {
  const calls: Array<{ method: string; input: unknown }> = []
  const activations: unknown[] = []
  const auth = {
    api: {
      getSession: async () => current,
      enableTwoFactor: async (input: unknown) => {
        calls.push({ method: 'enable', input })
        return { method: 'totp', totpURI: 'otpauth://totp/Suannn', backupCodes: ['one', 'two'] }
      },
      verifyTOTP: async (input: unknown) => {
        calls.push({ method: 'verify', input })
        return {
          headers: new Headers({ 'set-cookie': 'session=token' }),
          response: { token: 'token', user: restrictedSession.user },
        }
      },
      generateBackupCodes: async (input: unknown) => {
        calls.push({ method: 'generate', input })
        return { status: true, backupCodes: ['new-one', 'new-two'] }
      },
      viewBackupCodes: async (input: unknown) => {
        calls.push({ method: 'view', input })
        return { status: true, backupCodes: [] }
      },
    },
  } as unknown as Auth
  const store = {
    async activate(
      userId: string,
      sessionToken: string,
      activatedAt: Date,
      absoluteExpiresAt: Date,
    ) {
      activations.push({ userId, sessionToken, activatedAt, absoluteExpiresAt })
    },
    async resetForRecovery() {
      return { email: 'owner@example.com' }
    },
  }
  const service = new StaffMfaService({
    auth,
    store,
    now: () => now,
  })

  return { service, auth, store, calls, activations }
}

describe('staff MFA lifecycle', () => {
  it('allows only inactive staff to begin enrollment and returns initial codes once', async () => {
    const headers = new Headers({ cookie: 'session=value' })
    const { service, calls } = createHarness(restrictedSession)
    const result = await service.beginEnrollment(headers, 'correct horse battery staple')

    expect(result).toEqual({
      totpURI: 'otpauth://totp/Suannn',
      backupCodes: ['one', 'two'],
    })
    expect(calls[0]).toMatchObject({ method: 'enable' })

    for (const current of [null, activeSession]) {
      await expect(createHarness(current).service.beginEnrollment(headers, 'password'))
        .rejects.toThrow('ONBOARDING_SESSION_REQUIRED')
    }
  })

  it('forces trustDevice false and activates an eight-hour non-sliding window', async () => {
    const headers = new Headers({ cookie: 'session=value' })
    const { service, calls, activations } = createHarness(restrictedSession)

    await service.verifyEnrollment(headers, '123456', {
      requestId: 'request-1', ipAddress: '127.0.0.1', userAgent: null,
    })

    expect(calls[0]).toMatchObject({
      method: 'verify',
      input: { body: { code: '123456', trustDevice: false }, headers },
    })
    expect(activations).toEqual([{
      userId: 'staff-1',
      sessionToken: 'token',
      activatedAt: now,
      absoluteExpiresAt: new Date('2026-09-22T18:00:00.000Z'),
    }])
  })

  it('regenerates backup codes only for active staff and never views stored codes', async () => {
    const headers = new Headers({ cookie: 'session=value' })
    const { service, calls } = createHarness(activeSession)
    const result = await service.regenerateBackupCodes('staff-1', headers, 'password', {
      requestId: 'request-1', ipAddress: '127.0.0.1', userAgent: null,
    })

    expect(result).toEqual({ backupCodes: ['new-one', 'new-two'] })
    expect(calls.map(({ method }) => method)).toEqual(['generate'])
    await createHarness(restrictedSession).service.regenerateBackupCodes('staff-1', headers, 'password', {
      requestId: 'request-1', ipAddress: '127.0.0.1', userAgent: null,
    })
  })

  it('sends a recovery enrollment email after final-owner state is reset', async () => {
    const messages: unknown[] = []
    const { auth, store } = createHarness(activeSession)
    const service = new StaffMfaService({
      auth,
      store,
      adminUrl: 'https://admin.example.com',
      emailSender: {
        async send(message) {
          messages.push(message)
          return { id: 'email-1' }
        },
      },
      runInBackground: (task) => void task(),
    })

    await service.resetForRecovery('staff-1')
    await Promise.resolve()

    expect(messages).toEqual([expect.objectContaining({
      to: 'owner@example.com',
      template: 'staff-mfa-recovery',
    })])
  })
})
