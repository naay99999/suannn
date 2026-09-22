import { cors } from '@elysiajs/cors'
import { Elysia } from 'elysia'
import type { AppConfig } from '../config/env'

export function createCorsPlugin(config: AppConfig) {
  return new Elysia({ name: 'cors' })
    .use(cors({
      origin: config.corsOrigins,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      credentials: true,
      maxAge: 86_400,
    }))
}
