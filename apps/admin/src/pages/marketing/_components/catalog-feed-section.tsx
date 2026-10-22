import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { Alert02Icon } from '@hugeicons/core-free-icons'
import { Alert, AlertDescription } from '@workspace/ui/components/alert'
import { Badge } from '@workspace/ui/components/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { QueryState } from '@/components/query-state'
import { CopyRow } from '@/components/copy-button'
import { resolveApiUrl } from '@/lib/api-url'
import { authSessionQuery } from '@/lib/auth-session'
import { hasPermission } from '@/lib/permissions'
import { catalogFeedUrl, catalogGuides, catalogProblemLabels, catalogWarningLabels } from '@/lib/marketing/catalog-feed'
import type { CatalogFeedSummary } from '@/lib/marketing/api'
import { marketingCatalogFeedQuery } from '@/lib/marketing/queries'
import { CatalogBrandSetting } from './catalog-brand-setting'

const feedUrl = catalogFeedUrl(resolveApiUrl(import.meta.env.VITE_API_URL, import.meta.env.PROD))

export function CatalogFeedSection() {
  const session = useQuery(authSessionQuery)
  if (!hasPermission(session.data, 'marketing:read')) return null
  return <CatalogFeed canUpdate={hasPermission(session.data, 'marketing:update')} />
}

function CatalogFeed({ canUpdate }: { canUpdate: boolean }) {
  const summary = useQuery(marketingCatalogFeedQuery)
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">ฟีดสินค้า</CardTitle>
        <CardDescription>ไฟล์สินค้าให้ Google, Meta และ TikTok ดึงไปทำโฆษณาสินค้าอัตโนมัติ ราคาและของในสต็อกอัปเดตตามร้าน</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <CopyRow label="คัดลอก" value={feedUrl}>
          <code className="block break-all rounded-md bg-muted px-2 py-1.5 text-xs">{feedUrl}</code>
        </CopyRow>
        <CatalogBrandSetting canUpdate={canUpdate} />
        {summary.isPending
          ? <QueryState kind="loading" />
          : summary.isError
            ? <QueryState kind="error" message={summary.error.message} onRetry={() => void summary.refetch()} />
            : <FeedSummary summary={summary.data} />}
        <SetupGuide />
      </CardContent>
    </Card>
  )
}

function FeedSummary({ summary }: { summary: CatalogFeedSummary }) {
  const { counts } = summary
  const stats = [
    { label: 'ในฟีด', value: counts.inFeed },
    { label: 'มีของ', value: counts.inStock },
    { label: 'หมด', value: counts.outOfStock },
    { label: 'ไม่ได้ใส่ในฟีด', value: counts.excluded },
  ]
  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((stat) => (
          <div className="flex flex-col gap-1 rounded-lg border p-3" key={stat.label}>
            <dt className="text-sm text-muted-foreground">{stat.label}</dt>
            <dd className="text-2xl font-semibold tabular-nums">{stat.value}</dd>
          </div>
        ))}
      </dl>
      {summary.warnings.map((code) => (
        <Alert key={code}>
          <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} />
          <AlertDescription>{catalogWarningLabels[code]}</AlertDescription>
        </Alert>
      ))}
      {summary.problems.length === 0
        ? <p className="text-sm text-muted-foreground">สินค้าทุกชิ้นพร้อมลงโฆษณา</p>
        : (
          <ul className="flex flex-col divide-y rounded-lg border">
            {summary.problems.map((problem) => (
              <li className="flex flex-wrap items-center justify-between gap-2 p-3" key={`${problem.variantId}-${problem.code}`}>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <Link className="w-fit font-medium text-primary underline-offset-4 hover:underline" to={`/products/${problem.productId}`}>{problem.productName}</Link>
                  <span className="text-sm text-muted-foreground">{problem.variantName}</span>
                  <span className="text-sm">{catalogProblemLabels[problem.code]}</span>
                </div>
                {problem.excluded
                  ? <Badge variant="destructive">ไม่ได้ใส่ในฟีด</Badge>
                  : <Badge variant="warning">ควรแก้</Badge>}
              </li>
            ))}
          </ul>
        )}
    </div>
  )
}

function SetupGuide() {
  return (
    <div className="flex flex-col gap-4">
      <h3 className="font-medium">วิธีเชื่อมฟีดกับแพลตฟอร์มโฆษณา</h3>
      <div className="grid gap-4 md:grid-cols-3">
        {catalogGuides.map((guide) => (
          <section className="flex flex-col gap-2" key={guide.platform}>
            <h4 className="text-sm font-medium">{guide.platform}</h4>
            <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm text-muted-foreground">
              {guide.steps.map((step) => <li key={step}>{step}</li>)}
            </ol>
          </section>
        ))}
      </div>
    </div>
  )
}
