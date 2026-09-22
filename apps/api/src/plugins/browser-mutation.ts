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

  return new Elysia({ name: 'browser-mutation' })
    .macro({
      browserMutation(target: BrowserClient) {
        return {
          beforeHandle({ request, set }) {
            const contentType = request.headers.get('content-type')
              ?.split(';', 1)[0]
              ?.trim()
              .toLowerCase()
            const originHeader = request.headers.get('origin')
            const fetchSite = request.headers.get('sec-fetch-site')?.toLowerCase()

            if (!originHeader || originHeader === 'null' || contentType !== 'application/json') {
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
        }
      },
    })
}
