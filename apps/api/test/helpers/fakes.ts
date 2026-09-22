import type { EmailMessage, EmailSender } from '../../src/modules/email/sender'

export class FakeEmailSender implements EmailSender {
  readonly messages: EmailMessage[] = []
  error: Error | undefined

  async send(message: EmailMessage) {
    this.messages.push(message)

    if (this.error) {
      throw this.error
    }

    return { id: `email-${this.messages.length}` }
  }
}
