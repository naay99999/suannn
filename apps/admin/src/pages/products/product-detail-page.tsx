import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@workspace/ui/components/empty'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@workspace/ui/components/table'
import { QueryState } from '@/components/query-state'
import { ApiRequestError, apiErrorMessage } from '@/lib/api-result'
import { productQuery } from '@/lib/catalog/queries'
import type { ProductDetail } from '@/lib/catalog/api'

const dateFormatter = new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'long', year: 'numeric' })
const moneyFormatter = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function categoryLabel(category: ProductDetail['category']) {
  return category === 'fresh' ? 'สินค้าสด' : 'สินค้าแปรรูป'
}

function statusLabel(status: ProductDetail['status']) {
  return status === 'published' ? 'เผยแพร่แล้ว' : status === 'draft' ? 'ร่าง' : 'เก็บถาวร'
}

function detailState(error: unknown) {
  if (error instanceof ApiRequestError && error.status === 404) return { kind: 'not-found' as const, message: 'ไม่พบสินค้า' }
  if (error instanceof ApiRequestError && error.status === 403) return { kind: 'forbidden' as const, message: 'ไม่มีสิทธิ์เข้าถึงสินค้านี้' }
  return { kind: 'error' as const, message: apiErrorMessage(error) }
}

function ProductDetail({ product }: { product: ProductDetail }) {
  return (
    <section className="flex flex-col gap-6 px-4 lg:px-6">
      <div className="flex flex-col gap-4">
        <Button className="w-fit" nativeButton={false} render={<Link to="/products" />} variant="outline">กลับไปหน้าสินค้า</Button>
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-semibold tracking-tight">{product.name}</h1>
            <Badge variant={product.status === 'published' ? 'default' : product.status === 'draft' ? 'secondary' : 'outline'}>{statusLabel(product.status)}</Badge>
          </div>
          {product.englishName && <p className="text-muted-foreground">{product.englishName}</p>}
          <p className="text-sm text-muted-foreground">{categoryLabel(product.category)} · {product.slug}</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="flex flex-col gap-3 rounded-lg border p-4">
          <h2 className="text-lg font-semibold">รายละเอียด</h2>
          <dl className="grid gap-4 text-sm">
            <DetailField label="คำอธิบาย" value={product.description} />
            <DetailField label="เรื่องราวจากสวน" value={product.originStory} />
            <DetailField label="วิธีเก็บรักษา" value={product.storageInstructions} />
            <DetailField label="แก้ไขล่าสุด" value={dateFormatter.format(new Date(product.updatedAt))} />
          </dl>
        </section>
        <section className="flex flex-col gap-3 rounded-lg border p-4">
          <h2 className="text-lg font-semibold">รูปสินค้า</h2>
          {product.imageUrl
            ? <img alt={product.imageAlt ?? product.name} className="max-h-72 w-full rounded-md border object-contain" src={product.imageUrl} />
            : <div aria-label="ไม่มีรูปภาพ" className="grid min-h-48 place-items-center rounded-md bg-muted text-sm text-muted-foreground" role="img">ไม่มีรูปภาพสินค้า</div>}
        </section>
      </div>

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold">รูปแบบสินค้า</h2>
          <p className="text-sm text-muted-foreground">ข้อมูลราคาและการขายที่ได้รับจากแค็ตตาล็อก</p>
        </div>
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>ชื่อรูปแบบ</TableHead>
                <TableHead>หน่วย</TableHead>
                <TableHead className="text-right">ราคา</TableHead>
                <TableHead>การขาย</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {product.variants.length > 0
                ? product.variants.map((variant) => (
                  <TableRow key={variant.id}>
                    <TableCell className="font-medium">{variant.sku}</TableCell>
                    <TableCell>{variant.name}</TableCell>
                    <TableCell>{variant.unit}</TableCell>
                    <TableCell className="text-right">฿{moneyFormatter.format(variant.priceSatang / 100)}</TableCell>
                    <TableCell>
                      <Badge variant={variant.archivedAt ? 'outline' : variant.salesEnabled ? 'default' : 'secondary'}>
                        {variant.archivedAt ? 'เก็บถาวร' : variant.salesEnabled ? 'เปิดขาย' : 'ปิดขาย'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
                : <TableRow><TableCell className="p-0" colSpan={5}><Empty className="min-h-32 border-0"><EmptyHeader><EmptyTitle>ยังไม่มีรูปแบบสินค้า</EmptyTitle><EmptyDescription>สินค้านี้ยังไม่มีรูปแบบให้แสดง</EmptyDescription></EmptyHeader></Empty></TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
      </section>
    </section>
  )
}

function DetailField({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="font-medium">{label}</dt>
      <dd className="whitespace-pre-wrap text-muted-foreground">{value || 'ยังไม่มีข้อมูล'}</dd>
    </div>
  )
}

export function Component() {
  const { productId } = useParams()
  const product = useQuery({ ...productQuery(productId ?? ''), enabled: Boolean(productId) })

  if (!productId) return <QueryState kind="not-found" message="ไม่พบสินค้า" />
  if (product.isPending) return <QueryState kind="loading" />
  if (product.error) {
    const state = detailState(product.error)
    return <QueryState kind={state.kind} message={state.message} onRetry={state.kind === 'error' ? () => void product.refetch() : undefined} />
  }

  return <ProductDetail product={product.data} />
}
