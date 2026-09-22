import { useState, type ComponentProps } from 'react'
import { Link } from 'react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  CustomerSupportIcon,
  UnfoldMoreIcon,
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
import { Avatar, AvatarFallback } from '@workspace/ui/components/avatar'
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
  const [settingsOpen, setSettingsOpen] = useState(false)

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
            <SidebarMenuItem>
              <SidebarMenuButton className="cursor-pointer" size="lg" onClick={() => setSettingsOpen(true)}>
                <Avatar variant="square">
                  <AvatarFallback>S</AvatarFallback>
                </Avatar>
                <span className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">shadcn</span>
                  <span className="truncate text-xs text-muted-foreground">m@example.com</span>
                </span>
                <HugeiconsIcon icon={UnfoldMoreIcon} strokeWidth={2} className="ml-auto" />
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  )
}
