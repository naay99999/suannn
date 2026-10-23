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
  url: string
}

export function NavMain({ items }: { items: NavigationItem[] }) {
  const { pathname } = useLocation()
  const { setOpenMobile } = useSidebar()

  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu aria-label="เมนูหลัก">
          {items.map((item) => {
            const matches = (url: string) => (url === '/' ? pathname === '/' : pathname === url || pathname.startsWith(`${url}/`))
            // A more specific sibling (/marketing/discounts under /marketing) owns the highlight.
            const isActive = matches(item.url) && !items.some((other) => other.url.length > item.url.length && matches(other.url))

            return (
              <SidebarMenuItem key={item.url}>
                <SidebarMenuButton
                  tooltip={item.title}
                  isActive={isActive}
                  render={<NavLink to={item.url} end={item.url === '/'} />}
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
