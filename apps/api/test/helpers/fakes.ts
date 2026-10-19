import type { EmailMessage, EmailSender } from '../../src/modules/email/sender'
import type { MediaStorage } from '../../src/modules/media/storage'

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

export class InMemoryMediaStorage implements MediaStorage {
  readonly objects = new Map<string, Uint8Array>()
  failNextPut?: boolean

  async put(key: string, body: Uint8Array) {
    if (this.failNextPut) {
      this.failNextPut = false
      throw new Error('Media storage put failed')
    }

    this.objects.set(key, body)
  }

  async delete(keys: string[]) {
    for (const key of keys) {
      this.objects.delete(key)
    }
  }
}
