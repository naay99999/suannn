import { useState } from 'react'
import { Button } from '@workspace/ui/components/button'
import { downloadBackupCodes } from '@/lib/backup-codes'

export function BackupCodesPanel({
  codes,
  title = 'Save your backup codes',
  description = 'Each code works once. Store them somewhere private before continuing.',
}: {
  codes: string[]
  title?: string
  description?: string
}) {
  const [feedback, setFeedback] = useState('')

  async function copyCodes() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('CLIPBOARD_UNAVAILABLE')
      await navigator.clipboard.writeText(codes.join('\n'))
      setFeedback('Backup codes copied.')
    } catch {
      setFeedback('Clipboard is unavailable. Select the codes above to copy them.')
    }
  }

  function saveFile() {
    try {
      downloadBackupCodes(codes)
      setFeedback('Backup-codes file downloaded.')
    } catch {
      setFeedback('Could not download the file. Copy the codes and save them securely.')
    }
  }

  return (
    <section className="flex flex-col gap-2" aria-labelledby="backup-codes-title">
      <h2 id="backup-codes-title" className="font-medium">{title}</h2>
      <p className="text-sm text-muted-foreground">{description}</p>
      <ul className="rounded-md border bg-muted p-4 font-mono text-sm">
        {codes.map((backupCode) => <li key={backupCode}>{backupCode}</li>)}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => void copyCodes()}>Copy backup codes</Button>
        <Button type="button" variant="outline" onClick={saveFile}>Download backup codes</Button>
      </div>
      <p className="min-h-5 text-sm text-muted-foreground" role="status" aria-live="polite">{feedback}</p>
    </section>
  )
}
