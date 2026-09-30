import { describe, expect, it } from 'bun:test'
import {
  EmailTaskQueue,
  createResendEmailSender,
  scheduleBackground,
} from '../../src/modules/email/sender'
import {
  invitationEmail,
  orderConfirmationEmail,
  resetPasswordEmail,
  verificationEmail,
} from '../../src/modules/email/templates'
import { sanitizeLogData } from '../../src/shared/logger'
import { FakeEmailSender } from '../helpers/fakes'

describe('authentication email', () => {
  it('builds verification, reset, and invitation messages', () => {
    expect(verificationEmail('https://store.example/verify?token=secret').subject)
      .toContain('Verify')
    expect(resetPasswordEmail('https://store.example/reset?token=secret').subject)
      .toContain('Reset')
    expect(invitationEmail('Support', 'https://admin.example/invite?token=secret').text)
      .toContain('Support')
  })

  it('records messages with an injectable sender', async () => {
    const sender = new FakeEmailSender()
    const content = verificationEmail('https://store.example/verify?token=secret')

    await sender.send({
      to: 'customer@example.com',
      template: 'verify-email',
      ...content,
    })

    expect(sender.messages[0]).toMatchObject({
      to: 'customer@example.com',
      template: 'verify-email',
    })
  })

  it('logs a rejected background delivery once without exposing secrets', async () => {
    const entries: unknown[] = []
    const tasks: Promise<unknown>[] = []
    const callbackUrl = 'https://store.example/verify?token=secret'

    scheduleBackground(
      () => Promise.reject(new Error(`provider rejected ${callbackUrl}`)),
      { template: 'verify-email' },
      {
        error(entry) {
          entries.push(entry)
        },
      },
      (task) => tasks.push(task()),
    )

    await expect(Promise.all(tasks)).resolves.toEqual([undefined])
    expect(entries).toHaveLength(1)
    expect(JSON.stringify(entries)).not.toContain('token=')
    expect(JSON.stringify(entries)).not.toContain(callbackUrl)
  })

  it('redacts authentication secrets recursively', () => {
    const sanitized = sanitizeLogData({
      password: 'password-secret',
      cookie: 'cookie-secret',
      nested: {
        sessionToken: 'session-secret',
        totpSecret: 'totp-secret',
        backupCodes: ['backup-secret'],
      },
      safe: 'visible',
    })
    const serialized = JSON.stringify(sanitized)

    expect(serialized).not.toContain('password-secret')
    expect(serialized).not.toContain('cookie-secret')
    expect(serialized).not.toContain('session-secret')
    expect(serialized).not.toContain('totp-secret')
    expect(serialized).not.toContain('backup-secret')
    expect(serialized).toContain('visible')
  })

  it('maps a Resend acceptance to the provider message id', async () => {
    const sender = createResendEmailSender(
      { apiKey: 're_test', from: 'Suannn <auth@example.com>' },
      {
        emails: {
          send: async () => ({ data: { id: 'provider-id' }, error: null }),
        },
      },
    )

    await expect(sender.send({
      to: 'customer@example.com',
      template: 'reset-password',
      ...resetPasswordEmail('https://store.example/reset?token=secret'),
    })).resolves.toEqual({ id: 'provider-id' })
  })

  it('bounds active email delivery, waiting work, and drain time', async () => {
    const queue = new EmailTaskQueue(1, 1)
    let finishFirst!: () => void
    let active = 0
    let maximumActive = 0
    const first = new Promise<void>((resolve) => { finishFirst = resolve })
    const tracked = (wait?: Promise<void>) => async () => {
      active += 1
      maximumActive = Math.max(maximumActive, active)
      await wait
      active -= 1
    }
    queue.enqueue(tracked(first))
    queue.enqueue(tracked())
    queue.enqueue(tracked())
    expect(await queue.drain(5)).toBe(false)
    finishFirst()
    expect(await queue.drain(100)).toBe(true)
    expect(maximumActive).toBe(1)
  })
})

describe('order confirmation email', () => {
  it('includes a guest order link without the access token in the URL', () => {
    const content = orderConfirmationEmail('order-123', 'S-2026-0001', 'https://shop.example.test', 'guest-secret')

    expect(content.text).toContain('https://shop.example.test/orders/guest/order-123')
    expect(content.html).toContain('https://shop.example.test/orders/guest/order-123')
    expect(content.text).toContain('guest-secret')
    const links = content.html.match(/href="([^"]+)"/g) ?? []
    expect(links.some(link => link.includes('guest-secret'))).toBe(false)
  })
})
