import { Elysia } from 'elysia'
import type { AppConfig } from '../config/env'

type BrowserClient = 'storefront' | 'admin'

function reject(set: { status?: number | string }) {
  set.status = 403
  return { code: 'CSRF_REJECTED', message: 'Request rejected' }
}

export function createBrowserMutationPlugin(config: AppConfig) {
  const trustedOrigins: Record<BrowserClient, string> = {
    storefront: config.storefrontUrl,
    admin: config.adminUrl,
  }

  const guard = (target: BrowserClient, expectedContentType: string) => ({
    beforeHandle({ request, set }: { request: Request; set: { status?: number | string } }) {
      const contentType = request.headers.get('content-type')
        ?.split(';', 1)[0]
        ?.trim()
        .toLowerCase()
      const originHeader = request.headers.get('origin')
      const fetchSite = request.headers.get('sec-fetch-site')?.toLowerCase()

      if (!originHeader || originHeader === 'null' || contentType !== expectedContentType) {
        return reject(set)
      }

      if (fetchSite === 'cross-site') {
        return reject(set)
      }

      try {
        const parsedOrigin = new URL(originHeader)

        if (parsedOrigin.origin !== originHeader || parsedOrigin.origin !== trustedOrigins[target]) {
          return reject(set)
        }
      } catch {
        return reject(set)
      }
    },
  })

  return new Elysia({ name: 'browser-mutation' })
    .macro({
      browserMutation: (target: BrowserClient) => guard(target, 'application/json'),
      // Multipart uploads cannot send JSON; every other CSRF check is identical.
      browserUpload: (target: BrowserClient) => guard(target, 'multipart/form-data'),
    })
}
