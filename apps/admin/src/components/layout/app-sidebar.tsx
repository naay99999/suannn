import { type ComponentProps } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  CustomerSupportIcon,
  CommandIcon,
  DashboardSquare01Icon,
  ShoppingBag01Icon,
  DeliveryBox01Icon,
  SettingsIcon,
  UserListIcon,
} from '@hugeicons/core-free-icons'
import { NavMain } from '@/components/layout/nav-main'
import { AnimatedThemeToggler } from '@/components/layout/animated-theme-toggler'
import { SettingsDialog } from '@/pages/settings/_components/settings-dialog'
import { authSessionQuery } from '@/lib/auth-session'
import { StaffAccountMenu } from './staff-account-menu'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@workspace/ui/components/sidebar'

const navigation = [
  { title: 'Dashboard', url: '/dashboard', icon: DashboardSquare01Icon },
  { title: 'Orders', url: '/orders', icon: DeliveryBox01Icon },
  { title: 'Products', url: '/products', icon: ShoppingBag01Icon },
  { title: 'Customers', url: '/customers', icon: UserListIcon },
  { title: 'Settings', url: '/settings', icon: SettingsIcon },
]

export function AppSidebar(props: ComponentProps<typeof Sidebar>) {
  const { data: session } = useQuery(authSessionQuery)
  const { hash, pathname, search } = useLocation()
  const navigate = useNavigate()
  const settingsOpen = hash === '#settings' || hash.startsWith('#settings/')

  function handleSettingsOpenChange(open: boolean) {
    if (!open && settingsOpen) {
      navigate({ pathname, search, hash: '' })
    }
  }

  return (
    <>
      <Sidebar collapsible="offcanvas" {...props}>
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton render={<Link to="/dashboard" />}>
                <HugeiconsIcon icon={CommandIcon} strokeWidth={2} />
                <span className="text-base font-semibold">Suannn</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <NavMain items={navigation} />
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <AnimatedThemeToggler />
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton className="cursor-pointer">
                <HugeiconsIcon icon={CustomerSupportIcon} strokeWidth={2} />
                <span>Support</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            {session?.staff && <SidebarMenuItem><StaffAccountMenu session={session} /></SidebarMenuItem>}
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
      <SettingsDialog open={settingsOpen} onOpenChange={handleSettingsOpenChange} />
    </>
  )
}
