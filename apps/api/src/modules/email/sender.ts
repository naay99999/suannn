import { Resend } from 'resend'
import { logError } from '../../shared/logger'
import type { EmailContent } from './templates'

export type EmailTemplate =
  | 'verify-email'
  | 'reset-password'
  | 'staff-invitation'
  | 'staff-mfa-recovery'
  | 'change-email'

export interface EmailMessage extends EmailContent {
  to: string
  template: EmailTemplate
}

export interface EmailSender {
  send(message: EmailMessage): Promise<{ id: string | null }>
}

interface ResendLike {
  emails: {
    send(message: {
      from: string
      to: string
      subject: string
      text: string
      html: string
    }): Promise<{
      data: { id: string } | null
      error: { name?: string; message: string } | null
    }>
  }
}

export interface EmailDeliveryLogger {
  error(entry: {
    code: 'EMAIL_DELIVERY_FAILED'
    message: 'Email delivery failed'
    template: EmailTemplate
    errorCategory: string
  }): void
  info?(entry: {
    code: 'EMAIL_DELIVERY_ACCEPTED'
    template: EmailTemplate
    providerMessageId: string | null
  }): void
}

export class EmailTaskQueue {
  private readonly waiting: Array<() => Promise<unknown>> = []
  private active = 0
  private accepting = true
  private readonly settled = new Set<Promise<void>>()

  constructor(private readonly maximumActive = 4, private readonly maximumWaiting = 256) {}

  enqueue(task: () => Promise<unknown>) {
    if (!this.accepting || this.waiting.length >= this.maximumWaiting) {
      logError({ level: 'error', code: 'EMAIL_QUEUE_FULL', message: 'Email delivery queue is full' })
      return
    }
    this.waiting.push(task)
    this.pump()
  }

  async drain(timeoutMs: number) {
    this.accepting = false
    this.pump()
    const deadline = Date.now() + timeoutMs
    while ((this.active > 0 || this.waiting.length > 0) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(25, deadline - Date.now())))
    }
    return this.active === 0 && this.waiting.length === 0
  }

  private pump() {
    while (this.active < this.maximumActive && this.waiting.length > 0) {
      const task = this.waiting.shift()!
      this.active += 1
      const running = Promise.resolve().then(task).then(() => undefined).catch((error: unknown) => {
        logError({
          level: 'error', code: 'BACKGROUND_TASK_FAILED',
          message: error instanceof Error ? error.name : 'UnknownError',
        })
      }).finally(() => {
        this.active -= 1
        this.settled.delete(running)
        this.pump()
      })
      this.settled.add(running)
    }
  }
}

const defaultEmailLogger: EmailDeliveryLogger = {
  error(entry) {
    logError({
      level: 'error',
      code: entry.code,
      message: entry.message,
    })
  },
}

export function createResendEmailSender(
  config: { apiKey: string; from: string },
  provider: ResendLike = new Resend(config.apiKey) as ResendLike,
): EmailSender {
  return {
    async send(message) {
      const result = await provider.emails.send({
        from: config.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      })

      if (result.error) {
        throw new Error(result.error.name || 'RESEND_DELIVERY_ERROR')
      }

      return { id: result.data?.id ?? null }
    },
  }
}

export function scheduleBackground(
  task: () => Promise<{ id: string | null }>,
  context: { template: EmailTemplate },
  logger: EmailDeliveryLogger = defaultEmailLogger,
  runInBackground: (task: () => Promise<unknown>) => void = (backgroundTask) => {
    void backgroundTask().catch(() => undefined)
  },
) {
  const handledTask = async () => task().then(({ id }) => {
    logger.info?.({
      code: 'EMAIL_DELIVERY_ACCEPTED',
      template: context.template,
      providerMessageId: id,
    })
  }).catch((error: unknown) => {
    logger.error({
      code: 'EMAIL_DELIVERY_FAILED',
      message: 'Email delivery failed',
      template: context.template,
      errorCategory: error instanceof Error ? error.name : 'UnknownError',
    })
  })

  runInBackground(handledTask)
}
