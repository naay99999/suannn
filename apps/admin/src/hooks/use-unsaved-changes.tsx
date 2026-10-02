import { useEffect, useMemo } from 'react'
import { useBlocker } from 'react-router'
import { Button } from '@workspace/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog'

export function useUnsavedChanges(dirty: boolean) {
  const blocker = useBlocker(dirty)

  useEffect(() => {
    if (!dirty) return
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [dirty])

  return useMemo(() => (
    <Dialog
      open={blocker.state === 'blocked'}
      onOpenChange={(open) => {
        if (!open && blocker.state === 'blocked') blocker.reset()
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>ยังไม่ได้บันทึกการเปลี่ยนแปลง</DialogTitle>
          <DialogDescription>หากออกจากหน้านี้ ข้อมูลที่แก้ไขจะหายไป</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={() => blocker.state === 'blocked' && blocker.reset()} variant="outline">อยู่หน้านี้ต่อ</Button>
          <Button onClick={() => blocker.state === 'blocked' && blocker.proceed()} variant="destructive">ทิ้งการเปลี่ยนแปลง</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ), [blocker])
}
