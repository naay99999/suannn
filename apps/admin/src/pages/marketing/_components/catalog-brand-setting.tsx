import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@workspace/ui/components/button'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@workspace/ui/components/field'
import { Input } from '@workspace/ui/components/input'
import { QueryState } from '@/components/query-state'
import { catalogBrandSchema, type CatalogBrandFormValues } from '@/lib/marketing/catalog-feed'
import { marketingSettingsQuery, useUpdateCatalogBrandMutation } from '@/lib/marketing/queries'

export function CatalogBrandSetting({ canUpdate }: { canUpdate: boolean }) {
  const settings = useQuery(marketingSettingsQuery)

  if (settings.isPending) return <QueryState kind="loading" />
  if (settings.isError) return <QueryState kind="error" message={settings.error.message} onRetry={() => void settings.refetch()} />
  if (!canUpdate) {
    return (
      <div className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground">ชื่อแบรนด์ในฟีด</span>
        <span className="font-medium">{settings.data.catalogBrandName}</span>
      </div>
    )
  }
  return <BrandForm name={settings.data.catalogBrandName} version={settings.data.version} />
}

function BrandForm({ name, version }: { name: string; version: number }) {
  const update = useUpdateCatalogBrandMutation()
  const form = useForm<CatalogBrandFormValues>({
    resolver: zodResolver(catalogBrandSchema),
    defaultValues: { catalogBrandName: name },
  })
  const { isDirty, errors } = form.formState

  useEffect(() => {
    if (!isDirty) form.reset({ catalogBrandName: name })
  }, [name, form, isDirty])

  const error = update.error
  const conflict = error && 'code' in error && error.code === 'MARKETING_SETTINGS_CONFLICT'
  const fieldError = errors.catalogBrandName?.message
  const invalid = Boolean(fieldError || error)

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit((values) => {
        update.mutate({ catalogBrandName: values.catalogBrandName, version }, { onSuccess: (saved) => form.reset({ catalogBrandName: saved.catalogBrandName }) })
      })}
    >
      <FieldGroup>
        <Field data-invalid={invalid ? true : undefined}>
          <FieldLabel htmlFor="catalog-brand">ชื่อแบรนด์ในฟีด</FieldLabel>
          <div className="flex flex-wrap items-center gap-3">
            <Input
              aria-invalid={invalid ? true : undefined}
              className="max-w-xs"
              id="catalog-brand"
              maxLength={70}
              {...form.register('catalogBrandName', { onChange: () => update.reset() })}
            />
            <Button disabled={!isDirty || update.isPending} type="submit">บันทึกชื่อแบรนด์</Button>
          </div>
          <FieldDescription>ชื่อที่แสดงในโฆษณาสินค้า ไม่เกิน 70 ตัวอักษร</FieldDescription>
          {fieldError && <FieldError>{fieldError}</FieldError>}
          {error && <FieldError>{conflict ? 'มีคนแก้ไขค่านี้ไปแล้ว กรุณาลองอีกครั้ง' : error.message}</FieldError>}
        </Field>
      </FieldGroup>
    </form>
  )
}
