import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@workspace/ui/components/dialog'
import { SettingsWorkspace } from './settings-workspace'

export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[min(34rem,calc(100svh-2rem))] max-w-[calc(100%-2rem)] overflow-hidden p-0 sm:max-w-3xl" showCloseButton={false}>
        <DialogTitle className="sr-only">Account settings</DialogTitle>
        <DialogDescription className="sr-only">Customize your account settings.</DialogDescription>
        <SettingsWorkspace />
      </DialogContent>
    </Dialog>
  )
}
