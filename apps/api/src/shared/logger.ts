interface RequestLog {
  level: 'info'
  method: string
  path: string
  status: number
  durationMs: number
}

interface ErrorLog {
  level: 'error'
  code: string
  message: string
  stack?: string
}

export function logRequest(entry: RequestLog) {
  console.info(JSON.stringify(entry))
}

export function logError(entry: ErrorLog) {
  console.error(JSON.stringify(entry))
}

const redactedKeys = new Set([
  'password',
  'cookie',
  'sessiontoken',
  'totpsecret',
  'backupcodes',
])

export function sanitizeLogData(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeLogData)
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [
      key,
      redactedKeys.has(key.toLowerCase()) ? '[REDACTED]' : sanitizeLogData(child),
    ]))
  }

  return value
}
