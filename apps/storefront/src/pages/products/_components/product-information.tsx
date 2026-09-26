import { Tabs, TabsContent, TabsList, TabsTrigger } from '@workspace/ui/components/tabs'
import type { Product } from '@/lib/catalog'

export function ProductInformation({ product }: { product: Product }) {
  return (
    <Tabs defaultValue="storage" className="mt-8">
      <TabsList aria-label="รายละเอียดสินค้า" className="max-w-full">
        <TabsTrigger value="storage">การเก็บรักษา</TabsTrigger>
        <TabsTrigger value="details">{product.ingredients ? 'ส่วนประกอบ' : 'ข้อมูลผลผลิต'}</TabsTrigger>
      </TabsList>
      <TabsContent value="storage" className="pt-4 leading-7 text-muted-foreground">{product.storage}</TabsContent>
      <TabsContent value="details" className="pt-4 leading-7 text-muted-foreground">
        {product.ingredients ?? 'ขนาด สี และระดับความสุกของผลไม้แต่ละผลอาจแตกต่างกันตามธรรมชาติ รายละเอียดพันธุ์และมาตรฐานการคัดผลจริงจะยืนยันก่อนจำหน่าย'}
      </TabsContent>
    </Tabs>
  )
}
