export class ApiRequestError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message)
    this.name = 'ApiRequestError'
  }
}

type ErrorRecord = Record<string, unknown>
const messages: Record<string, string> = {
  PRODUCT_NOT_FOUND: 'ไม่พบสินค้า',
  VARIANT_NOT_FOUND: 'ไม่พบรูปแบบสินค้านี้',
  PRODUCT_SLUG_CONFLICT: 'URL สินค้านี้ถูกใช้งานแล้ว',
  SKU_CONFLICT: 'SKU นี้ถูกใช้งานแล้ว',
  PRODUCT_STATE_CONFLICT: 'ไม่สามารถดำเนินการกับสถานะสินค้านี้ได้',
  INVALID_PRODUCT: 'ข้อมูลสินค้าไม่ถูกต้อง',
  VALIDATION_ERROR: 'ข้อมูลที่ส่งมาไม่ถูกต้อง',
  AUTHENTICATION_REQUIRED: 'กรุณาเข้าสู่ระบบอีกครั้ง',
  SESSION_EXPIRED: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง',
  FORBIDDEN: 'คุณไม่มีสิทธิ์ดำเนินการนี้',
}

const networkMessage = 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาลองอีกครั้ง'
const rateLimitMessage = 'มีคำขอมากเกินไป กรุณาลองอีกครั้งภายหลัง'
const serverMessage = 'เซิร์ฟเวอร์ไม่สามารถดำเนินการได้ กรุณาลองอีกครั้ง'
const genericMessage = 'ไม่สามารถดำเนินการได้ กรุณาลองอีกครั้ง'

function isRecord(value: unknown): value is ErrorRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function bodyFromError(error: unknown): ErrorRecord {
  if (!isRecord(error)) return {}
  const value = error.value
  if (isRecord(value)) return value
  return error
}

function requestError(status: number, error: unknown): ApiRequestError {
  const body = bodyFromError(error)
  const code = typeof body.code === 'string'
    ? body.code
    : status === 429
      ? 'RATE_LIMITED'
      : status >= 500
        ? 'SERVER_ERROR'
        : 'API_REQUEST_FAILED'

  if (status === 503 && !('code' in body) && isRecord(error) && error.value instanceof Error) {
    return new ApiRequestError(0, 'NETWORK_ERROR', networkMessage)
  }

  return new ApiRequestError(status, code, apiErrorMessage({ status, code }))
}

export function apiData<T>(result: { data: T | null; error: unknown; status: number }): T {
  if (result.error !== null && result.error !== undefined) {
    throw requestError(result.status, result.error)
  }

  if (result.data === null) {
    throw new ApiRequestError(result.status || 502, 'EMPTY_RESPONSE', genericMessage)
  }

  return result.data
}

export function apiEmpty(result: { error: unknown; status: number }): void {
  if (result.error !== null && result.error !== undefined) {
    throw requestError(result.status, result.error)
  }
}

export function apiErrorMessage(error: unknown): string {
  const value = isRecord(error) ? error : {}
  const body = bodyFromError(error)
  const code = typeof value.code === 'string'
    ? value.code
    : typeof body.code === 'string'
      ? body.code
      : ''
  const status = typeof value.status === 'number'
    ? value.status
    : typeof body.status === 'number'
      ? body.status
      : 0

  if (messages[code]) return messages[code]
  if (code === 'NETWORK_ERROR' || status === 0) return networkMessage
  if (code === 'RATE_LIMITED' || status === 429) return rateLimitMessage
  if (status >= 500) return serverMessage
  return genericMessage
}

export async function apiRequest<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof ApiRequestError) throw error
    throw new ApiRequestError(0, 'NETWORK_ERROR', networkMessage)
  }
}
