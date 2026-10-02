import type { AuthSession } from './auth-session'

export function hasPermission(session: AuthSession | null | undefined, permission: string): boolean {
  return session?.staff?.permissions.includes(permission) ?? false
}
