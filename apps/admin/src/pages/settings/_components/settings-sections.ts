import { LockKeyIcon, NotificationIcon, PaintBoardIcon, SettingsIcon, UserListIcon } from '@hugeicons/core-free-icons'

export const settingsSections = [
  { id: 'profile', label: 'Profile', icon: UserListIcon },
  { id: 'account', label: 'Account', icon: SettingsIcon },
  { id: 'security', label: 'Security', icon: LockKeyIcon },
  { id: 'appearance', label: 'Appearance', icon: PaintBoardIcon },
  { id: 'notifications', label: 'Notifications', icon: NotificationIcon },
] as const

export type SettingsSectionId = (typeof settingsSections)[number]['id']

export function getSettingsSectionFromHash(hash: string): SettingsSectionId {
  const sectionId = hash.startsWith('#settings/') ? hash.slice('#settings/'.length) : 'profile'
  return settingsSections.find((section) => section.id === sectionId)?.id ?? 'profile'
}
