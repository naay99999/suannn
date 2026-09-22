import { Elysia } from 'elysia'
import type { AppConfig } from './config/env'
import { systemModule } from './modules/system'
import type { Auth } from './plugins/auth/auth'
import { createAuthPlugin } from './plugins/auth'
import { createCorsPlugin } from './plugins/cors'
import { createErrorHandlingPlugin } from './plugins/error-handling'
import { createRequestLoggingPlugin } from './plugins/request-logging'

export function createApp(config: AppConfig, auth: Auth) {
  return new Elysia({ name: 'api' })
    .use(createCorsPlugin(config))
    .use(createErrorHandlingPlugin())
    .use(createRequestLoggingPlugin())
    .use(createAuthPlugin(auth))
    .use(systemModule)
}

export type App = ReturnType<typeof createApp>
