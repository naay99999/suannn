import { AccountRequestError } from './account-api'

export type AccountErrorKind = 'signed-out' | 'forbidden' | 'not-found' | 'retry'

export function classifyAccountError(error: unknown): AccountErrorKind {
  if (!(error instanceof AccountRequestError)) return 'retry'
  if (error.status === 401) return 'signed-out'
  if (error.status === 403) return 'forbidden'
  if (error.status === 404) return 'not-found'
  return 'retry'
}
