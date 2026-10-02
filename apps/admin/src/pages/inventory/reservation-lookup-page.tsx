import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router'
import { Button, buttonVariants } from '@workspace/ui/components/button'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@workspace/ui/components/field'
import { Input } from '@workspace/ui/components/input'
import { cn } from '@workspace/ui/lib/utils'
import { QueryState } from '@/components/query-state'
import { ApiRequestError, apiErrorMessage } from '@/lib/api-result'
import { reservationLookupSchema } from '@/lib/inventory/forms'
import { reservationQuery } from '@/lib/inventory/queries'

type ReservationLookupValues = { reservationId: string }

function lookupError(error: unknown) {
  if (error instanceof ApiRequestError && error.status === 404) return { kind: 'not-found' as const, message: 'ไม่พบการจองนี้' }
  if (error instanceof ApiRequestError && error.status === 403) return { kind: 'forbidden' as const, message: 'ไม่มีสิทธิ์อ่านการจองนี้' }
  return { kind: 'error' as const, message: apiErrorMessage(error) }
}

export function Component() {
  const navigate = useNavigate()
  const [submittedId, setSubmittedId] = useState('')
  const form = useForm<ReservationLookupValues>({
    resolver: zodResolver(reservationLookupSchema),
    defaultValues: { reservationId: '' },
  })
  const reservation = useQuery({ ...reservationQuery(submittedId), enabled: Boolean(submittedId) })

  useEffect(() => {
    if (submittedId && reservation.data) navigate(`/inventory/reservations/${submittedId}`)
  }, [navigate, reservation.data, submittedId])

  function submit(values: ReservationLookupValues) {
    setSubmittedId(values.reservationId.trim())
  }

  const error = form.formState.errors.reservationId?.message
  const requestError = reservation.error ? lookupError(reservation.error) : null

  return (
    <section className="flex flex-col gap-6 px-4 lg:px-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">ค้นหาการจองสินค้า</h1>
        <p className="text-sm text-muted-foreground">การจองไม่มีรายการรวมให้ค้นหา ใช้รหัสการจองที่ได้รับเพื่อเปิดรายละเอียด</p>
      </div>
      <nav aria-label="นำทางคลังสินค้า" className="flex flex-wrap gap-2">
        <Link className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))} to="/inventory">กลับไปหน้าสต็อก</Link>
        <Link className={cn(buttonVariants({ size: 'sm' }))} to="/inventory/reservations/new">สร้างการจอง</Link>
      </nav>
      <form className="flex max-w-2xl flex-col gap-5 rounded-lg border p-4" noValidate onSubmit={form.handleSubmit(submit)}>
        <FieldGroup>
          <Field data-invalid={Boolean(error)}>
            <FieldLabel htmlFor="reservation-lookup-id">รหัสการจอง</FieldLabel>
            <Input
              aria-describedby={error ? 'reservation-lookup-id-error' : 'reservation-lookup-id-help'}
              aria-invalid={Boolean(error)}
              autoComplete="off"
              id="reservation-lookup-id"
              maxLength={36}
              placeholder="00000000-0000-4000-8000-000000000000"
              {...form.register('reservationId')}
            />
            <FieldDescription id="reservation-lookup-id-help">วาง UUID ของการจองที่ต้องการตรวจสอบ</FieldDescription>
            <FieldError id="reservation-lookup-id-error">{error}</FieldError>
          </Field>
        </FieldGroup>
        {reservation.isFetching && <p aria-live="polite" className="text-sm text-muted-foreground" role="status">กำลังค้นหาการจอง...</p>}
        {requestError && <QueryState kind={requestError.kind} message={requestError.message} onRetry={requestError.kind === 'error' ? () => void reservation.refetch() : undefined} />}
        <Button disabled={reservation.isFetching} type="submit">ค้นหาการจอง</Button>
      </form>
    </section>
  )
}
