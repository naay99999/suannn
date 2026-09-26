import { cors } from '@elysiajs/cors'
import { Elysia } from 'elysia'
import type { AppConfig } from '../config/env'

export function createCorsPlugin(config: AppConfig) {
  return new Elysia({ name: 'cors' })
    .use(cors({
      origin: (request) => {
        const origin = request.headers.get('origin')
        if (!origin) return false

        const path = new URL(request.url).pathname
        if (path === '/api/v1/store' || path.startsWith('/api/v1/store/')) {
          return origin === config.storefrontUrl
        }
        if (path === '/api/v1/admin' || path.startsWith('/api/v1/admin/')) {
          return origin === config.adminUrl
        }

        return config.corsOrigins.includes(origin)
      },
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Order-Access-Token'],
      credentials: true,
      maxAge: 86_400,
    }))
}
