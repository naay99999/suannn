import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { buttonVariants } from '@workspace/ui/components/button'
import { cn } from '@workspace/ui/lib/utils'
import { useUnsavedChanges } from '@/hooks/use-unsaved-changes'
import { FarmForm } from './_components/farm-form'

export function Component() {
  const navigate = useNavigate()
  const [dirty, setDirty] = useState(false)
  const confirmationDialog = useUnsavedChanges(dirty)

  return (
    <section className="flex flex-col gap-6 px-4 lg:px-6">
      <div className="flex flex-col gap-3">
        <Link className={cn(buttonVariants({ variant: 'outline' }), 'w-fit')} to="/farms">กลับไปหน้าฟาร์ม</Link>
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-semibold tracking-tight">สร้างฟาร์ม</h1>
          <p className="text-muted-foreground">สร้างฟาร์มเป็นฉบับร่างก่อนกรอกข้อมูลให้ครบและเผยแพร่</p>
        </div>
      </div>
      <FarmForm mode="create" onCreated={(farmId) => navigate(`/farms/${farmId}`, { replace: true })} onDirtyChange={setDirty} />
      {confirmationDialog}
    </section>
  )
}
