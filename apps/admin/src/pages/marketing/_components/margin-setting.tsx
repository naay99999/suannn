import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@workspace/ui/components/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@workspace/ui/components/field'
import { Input } from '@workspace/ui/components/input'
import { QueryState } from '@/components/query-state'
import { formatRoas } from '@/lib/marketing/format'
import { marketingSettingsQuery, useUpdateMarginMutation } from '@/lib/marketing/queries'

export function MarginSetting({ canUpdate }: { canUpdate: boolean }) {
  const settings = useQuery(marketingSettingsQuery)
  const update = useUpdateMarginMutation()
  const [draft, setDraft] = useState<string | null>(null)

  if (settings.isPending) return <QueryState kind="loading" />
  if (settings.isError) return <QueryState kind="error" message={settings.error.message} onRetry={() => void settings.refetch()} />

  const value = draft ?? String(settings.data.marginPercent)
  const margin = value.trim() === '' ? NaN : Number(value)
  const breakEven = Number.isFinite(margin) && margin > 0 ? 100 / margin : null
  const dirty = draft !== null && margin !== settings.data.marginPercent
  const error = update.error
  const conflict = error && 'code' in error && error.code === 'MARKETING_SETTINGS_CONFLICT'

  return (
    <form
      className="flex max-w-xl flex-col gap-3 rounded-xl border bg-card p-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (!canUpdate || !Number.isFinite(margin)) return
        update.mutate({ marginPercent: margin, version: settings.data.version }, { onSuccess: () => setDraft(null) })
      }}
    >
      <Field data-invalid={error ? true : undefined}>
        <FieldLabel htmlFor="marketing-margin">กำไรขั้นต้น (%)</FieldLabel>
        <div className="flex flex-wrap items-center gap-3">
          <Input
            aria-invalid={error ? true : undefined}
            className="w-28"
            disabled={!canUpdate}
            id="marketing-margin"
            inputMode="decimal"
            onChange={(event) => { update.reset(); setDraft(event.target.value) }}
            step="any"
            type="number"
            value={value}
          />
          {canUpdate && <Button disabled={!dirty || !Number.isFinite(margin) || update.isPending} type="submit">บันทึก</Button>}
          <span className="text-sm text-muted-foreground">ROAS เท่าทุน {formatRoas(breakEven)}</span>
        </div>
        <FieldDescription>ใช้คำนวณว่าแคมเปญกำไร เท่าทุน หรือขาดทุน (ROAS เท่าทุน = 100 ÷ กำไรขั้นต้น)</FieldDescription>
        {error && <FieldError>{conflict ? 'มีคนแก้ไขค่านี้ไปแล้ว กรุณาลองอีกครั้ง' : error.message}</FieldError>}
      </Field>
    </form>
  )
}
