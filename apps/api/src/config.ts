export const developmentCorsOrigins = [
  'http://localhost:5183',
  'http://127.0.0.1:5183',
  'http://localhost:4183',
  'http://127.0.0.1:4173',
  'http://localhost:5184',
  'http://127.0.0.1:5184',
  'http://localhost:4184',
  'http://127.0.0.1:4174',
]

export interface AppConfig {
  host: string
  port: number
  corsOrigins: string[]
}

type Environment = Record<string, string | undefined>

function parsePort(value: string | undefined) {
  if (!value) {
    return 6767
  }

  const port = Number(value)

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be an integer between 1 and 65535')
  }

  return port
}

function parseOrigins(value: string | undefined) {
  if (!value) {
    return []
  }

  return [...new Set(value.split(',').map((origin) => origin.trim()).filter(Boolean).map((origin) => {
    try {
      const url = new URL(origin)

      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error()
      }

      return url.origin
    } catch {
      throw new Error('CORS_ORIGINS must contain valid HTTP(S) origins')
    }
  }))]
}

export function loadConfig(env: Environment = process.env): AppConfig {
  const corsOrigins = parseOrigins(env.CORS_ORIGINS)
  const isProduction = env.NODE_ENV === 'production'

  if (isProduction && corsOrigins.length === 0) {
    throw new Error('CORS_ORIGINS is required when NODE_ENV is production')
  }

  return {
    host: env.HOST?.trim() || '0.0.0.0',
    port: parsePort(env.PORT),
    corsOrigins: corsOrigins.length > 0 ? corsOrigins : developmentCorsOrigins,
  }
}
