import { Resend } from 'resend'
import { logError } from '../../shared/logger'
import type { EmailContent } from './templates'

export type EmailTemplate =
  | 'verify-email'
  | 'reset-password'
  | 'staff-invitation'
  | 'staff-mfa-recovery'

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
  task: Promise<{ id: string | null }>,
  context: { template: EmailTemplate },
  logger: EmailDeliveryLogger = defaultEmailLogger,
  runInBackground: (task: Promise<unknown>) => void = (backgroundTask) => {
    void backgroundTask
  },
) {
  const handledTask = task.then(({ id }) => {
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
