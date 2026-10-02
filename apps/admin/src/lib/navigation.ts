import type { AuthSession } from './auth-session'
import { hasPermission } from './permissions'

type PermissionNavigationItem = { permission?: string }

export function filterNavigationForSession<T extends PermissionNavigationItem>(items: T[], session: AuthSession | null | undefined): T[] {
  return items.filter((item) => !item.permission || hasPermission(session, item.permission))
}
