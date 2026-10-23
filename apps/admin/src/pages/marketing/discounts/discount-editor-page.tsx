import { Link, useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@workspace/ui/components/breadcrumb'
import { QueryState } from '@/components/query-state'
import { ApiRequestError, apiErrorMessage } from '@/lib/api-result'
import { authSessionQuery } from '@/lib/auth-session'
import { discountQuery } from '@/lib/discounts/queries'
import { hasPermission } from '@/lib/permissions'
import { DiscountForm } from './_components/discount-form'
import { DiscountStats } from './_components/discount-stats'

function Header({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <header className="flex flex-col gap-3">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem><BreadcrumbLink render={<Link to="/marketing" />}>การตลาด</BreadcrumbLink></BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbLink render={<Link to="/marketing/discounts" />}>โค้ดส่วนลด</BreadcrumbLink></BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbPage>{title}</BreadcrumbPage></BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <div className="flex flex-col gap-1">
        <h1 className="text-headline font-semibold tracking-tight">{title}</h1>
        <p className="text-muted-foreground">{subtitle}</p>
      </div>
    </header>
  )
}

export function Component() {
  const { discountId } = useParams()
  const { data: session } = useQuery(authSessionQuery)
  const canUpdate = hasPermission(session, 'marketing:update')

  if (!discountId) {
    return (
      <section className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 lg:px-6">
        <Header subtitle="กำหนดรหัส ส่วนลด และเงื่อนไขการใช้" title="สร้างโค้ดส่วนลด" />
        {canUpdate
          ? <DiscountForm canUpdate discount={null} onReload={() => undefined} />
          : <QueryState kind="forbidden" />}
      </section>
    )
  }
  return <ExistingDiscount canUpdate={canUpdate} discountId={discountId} />
}

function ExistingDiscount({ discountId, canUpdate }: { discountId: string; canUpdate: boolean }) {
  const discount = useQuery(discountQuery(discountId))
  const data = discount.data
  const notFound = discount.error instanceof ApiRequestError && discount.error.status === 404

  return (
    <section className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 lg:px-6">
      <Header subtitle={data ? data.name : 'รายละเอียดและสถิติของโค้ด'} title={data ? data.code : 'โค้ดส่วนลด'} />
      {discount.isPending
        ? <QueryState kind="loading" />
        : notFound
          ? <QueryState kind="not-found" message="ไม่พบโค้ดส่วนลดนี้" />
          : !data
            ? <QueryState kind="error" message={apiErrorMessage(discount.error)} onRetry={() => void discount.refetch()} />
            : <>
              <DiscountStats discount={data} />
              {/* Remounting on a new version resets the form to the saved (or freshly reloaded) values. */}
              <DiscountForm canUpdate={canUpdate} discount={data} key={`${data.id}:${data.version}`} onReload={() => void discount.refetch()} />
            </>}
    </section>
  )
}
