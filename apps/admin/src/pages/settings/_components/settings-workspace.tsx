import { useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { NotificationIcon, PaintBoardIcon, SettingsIcon, UserListIcon } from '@hugeicons/core-free-icons'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Checkbox } from '@workspace/ui/components/checkbox'
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldTitle } from '@workspace/ui/components/field'
import { Input } from '@workspace/ui/components/input'
import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider } from '@workspace/ui/components/sidebar'
import { cn } from '@workspace/ui/lib/utils'

const sections = [
  { id: 'profile', label: 'Profile', icon: UserListIcon },
  { id: 'account', label: 'Account', icon: SettingsIcon },
  { id: 'appearance', label: 'Appearance', icon: PaintBoardIcon },
  { id: 'notifications', label: 'Notifications', icon: NotificationIcon },
] as const

type SectionId = (typeof sections)[number]['id']

function SettingsForm({ section }: { section: SectionId }) {
  const [saved, setSaved] = useState(false)
  const [emailUpdates, setEmailUpdates] = useState(true)
  const [compactNavigation, setCompactNavigation] = useState(false)

  const content = {
    profile: {
      title: 'Profile',
      description: 'Update the details displayed across your admin workspace.',
      fields: (
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="settings-name">Display name</FieldLabel>
            <Input id="settings-name" defaultValue="shadcn" />
          </Field>
          <Field>
            <FieldLabel htmlFor="settings-email">Email address</FieldLabel>
            <Input id="settings-email" type="email" defaultValue="m@example.com" />
          </Field>
        </FieldGroup>
      ),
    },
    account: {
      title: 'Account',
      description: 'Review account preferences for this admin profile.',
      fields: (
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="settings-role">Role</FieldLabel>
            <Input id="settings-role" defaultValue="Administrator" readOnly />
          </Field>
          <Field orientation="horizontal">
            <Checkbox id="compact-navigation" checked={compactNavigation} onCheckedChange={setCompactNavigation} />
            <FieldContent>
              <FieldTitle>Compact navigation</FieldTitle>
              <FieldDescription>Use a more compact layout for navigation controls.</FieldDescription>
            </FieldContent>
          </Field>
        </FieldGroup>
      ),
    },
    appearance: {
      title: 'Appearance',
      description: 'Choose how the admin workspace feels while you work.',
      fields: (
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="settings-density">Display density</FieldLabel>
            <Input id="settings-density" defaultValue="Comfortable" readOnly />
            <FieldDescription>Theme controls will be available when preferences are connected to an account.</FieldDescription>
          </Field>
        </FieldGroup>
      ),
    },
    notifications: {
      title: 'Notifications',
      description: 'Choose which updates should appear in this demonstration.',
      fields: (
        <FieldGroup>
          <Field orientation="horizontal">
            <Checkbox id="email-updates" checked={emailUpdates} onCheckedChange={setEmailUpdates} />
            <FieldContent>
              <FieldTitle>Email updates</FieldTitle>
              <FieldDescription>Receive operational updates at your admin email address.</FieldDescription>
            </FieldContent>
          </Field>
        </FieldGroup>
      ),
    },
  }[section]

  return (
    <Card className="border-0 shadow-none ring-0">
      <CardHeader>
        <CardTitle>{content.title}</CardTitle>
        <CardDescription>{content.description}</CardDescription>
      </CardHeader>
      <CardContent>{content.fields}</CardContent>
      <CardFooter className="flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground" aria-live="polite">{saved ? 'Settings saved for this session.' : 'Changes are kept for this session only.'}</p>
        <Button onClick={() => setSaved(true)}>Save changes</Button>
      </CardFooter>
    </Card>
  )
}

function SettingsNavigation({ activeSection, onSelect }: { activeSection: SectionId; onSelect: (section: SectionId) => void }) {
  return (
    <Sidebar collapsible="none" className="hidden md:flex">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu aria-label="Settings navigation">
              {sections.map((section) => (
                <SidebarMenuItem key={section.id}>
                  <SidebarMenuButton isActive={section.id === activeSection} onClick={() => onSelect(section.id)}>
                    <HugeiconsIcon icon={section.icon} strokeWidth={2} />
                    <span>{section.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  )
}

export function SettingsWorkspace({ className }: { className?: string }) {
  const [activeSection, setActiveSection] = useState<SectionId>('profile')
  const activeLabel = sections.find((section) => section.id === activeSection)?.label

  return (
    <SidebarProvider className={cn('min-h-0 flex-1 items-start transform-gpu', className)}>
      <SettingsNavigation activeSection={activeSection} onSelect={setActiveSection} />
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <header className="flex shrink-0 flex-col gap-3 border-b px-4 py-4 md:flex-row md:items-center md:gap-2">
          <div className="flex items-center gap-2">
            <p className="font-medium">Settings / {activeLabel}</p>
          </div>
          <div className="flex gap-1 overflow-x-auto md:hidden" aria-label="Settings navigation">
            {sections.map((section) => (
              <Button key={section.id} variant={section.id === activeSection ? 'secondary' : 'ghost'} size="sm" onClick={() => setActiveSection(section.id)}>
                {section.label}
              </Button>
            ))}
          </div>
        </header>
        <div className="flex flex-1 flex-col overflow-y-auto p-4">
          <div className="mx-auto w-full max-w-2xl">
            <SettingsForm section={activeSection} />
          </div>
        </div>
      </main>
    </SidebarProvider>
  )
}
