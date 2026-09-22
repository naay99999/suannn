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
