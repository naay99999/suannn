import { SettingsWorkspace } from '@/pages/settings/_components/settings-workspace'

export function Component() {
  return (
    <div className="flex flex-1 px-4 lg:px-6">
      <section className="flex min-h-[calc(100svh-var(--header-height)-3rem)] w-full overflow-hidden rounded-xl border bg-card">
        <SettingsWorkspace />
      </section>
    </div>
  )
}
