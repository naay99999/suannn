import { NavLink, useLocation } from 'react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import type { DashboardSquare01Icon } from '@hugeicons/core-free-icons'
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@workspace/ui/components/sidebar'

type NavigationItem = {
  title: string
  icon: typeof DashboardSquare01Icon
  url?: string
  hash?: string
}

export function NavMain({ items }: { items: NavigationItem[] }) {
  const { hash, pathname, search } = useLocation()
  const { setOpenMobile } = useSidebar()
  const settingsOpen = hash === '#settings'

  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu aria-label="Admin navigation">
          {items.map((item) => {
            const isHashNavigation = item.hash !== undefined
            const isActive = isHashNavigation
              ? hash === item.hash
              : !settingsOpen && (item.url === '/' ? pathname === '/' : pathname === item.url || pathname.startsWith(`${item.url}/`))
            const to = isHashNavigation
              ? { pathname, search, hash: item.hash }
              : item.url!

            return (
              <SidebarMenuItem key={item.url ?? item.hash}>
                <SidebarMenuButton
                  tooltip={item.title}
                  isActive={isActive}
                  render={<NavLink to={to} end={item.url === '/'} />}
                  onClick={() => setOpenMobile(false)}
                >
                  <HugeiconsIcon icon={item.icon} strokeWidth={2} />
                  <span>{item.title}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
