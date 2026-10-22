import type { EmailMessage, EmailSender } from '../../src/modules/email/sender'
import type { MediaStorage } from '../../src/modules/media/storage'
import type { ConsentRecordValues } from '../../src/modules/tracking/consent/repository'
import { ConsentService } from '../../src/modules/tracking/consent/service'

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

export class FakeConsentService extends ConsentService {
  readonly rows = new Map<string, ConsentRecordValues & { id: string }>()

  constructor() {
    super({
      insert: async (values: ConsentRecordValues) => {
        const id = crypto.randomUUID()
        this.rows.set(id, { ...values, id })

        return id
      },
      find: async (id: string) => this.rows.get(id) ?? null,
    })
  }
}

export const fakeTrackingStatus = {
  get: async () => ({
    destinations: (['posthog', 'meta', 'tiktok', 'google_ads'] as const).map((destination) => ({
      destination, configured: false, lastSuccessAt: null, failures24h: 0, lastErrorCode: null,
    })),
    adSpend: (['meta', 'tiktok', 'google'] as const).map((platform) => ({
      platform, configured: false, lastSuccessAt: null, lastRunStatus: null, lastErrorCode: null, earliestDate: null,
    })),
  }),
}

export const fakeMarketing = {
  metrics: { overview: async () => ({}) as never },
  settings: {
    get: async () => ({ marginPercent: 35, catalogBrandName: 'suannn', version: 1, updatedAt: '2026-10-01T00:00:00.000Z' }),
    update: async () => ({ marginPercent: 35, catalogBrandName: 'suannn', version: 1, updatedAt: '2026-10-01T00:00:00.000Z' }),
    updateCatalogBrand: async () => ({ marginPercent: 35, catalogBrandName: 'suannn', version: 1, updatedAt: '2026-10-01T00:00:00.000Z' }),
  },
  sync: { run: async () => [] },
  posthog: null,
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
