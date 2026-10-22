import { Button } from '@workspace/ui/components/button'
import { useConsent } from '@/components/consent/consent-context'

const POLICY_VERSION = '2026-10-21'
const PLACEHOLDER = '[ร่าง — เจ้าของร้านต้องแก้ไข]'

const toolCategories = [
  { name: 'จำเป็น', tools: 'การเข้าสู่ระบบ ตะกร้าสินค้า การชำระเงิน การบันทึกตัวเลือกคุกกี้ของคุณ และการจดจำช่องทางที่พาคุณมายังร้าน' },
  { name: 'วิเคราะห์การใช้งาน', tools: 'PostHog' },
  { name: 'การตลาด', tools: 'Meta (Facebook/Instagram) Pixel และ Conversions API, TikTok Pixel และ Events API, Google Ads' },
]

export function Component() {
  const { openSettings } = useConsent()

  return (
    <div className="w-full max-w-full overflow-x-clip">
      <title>นโยบายความเป็นส่วนตัว | suannn</title>
      <article className="page-width max-w-3xl pb-16 pt-4 md:pb-24 md:pt-10">
        <h1 className="text-display font-semibold tracking-tight">นโยบายความเป็นส่วนตัว</h1>
        <p className="mt-4 text-sm text-muted-foreground">ฉบับวันที่ {POLICY_VERSION}</p>
        <div className="mt-6">
          <Button variant="outline" onClick={openSettings}>ตั้งค่าคุกกี้</Button>
        </div>

        <section className="mt-12" aria-labelledby="privacy-collect">
          <h2 id="privacy-collect" className="text-headline font-semibold tracking-tight">ข้อมูลที่เราเก็บและเหตุผล</h2>
          <p className="mt-3 leading-8 text-muted-foreground">{PLACEHOLDER} อธิบายข้อมูลที่เก็บ เช่น บัญชี ที่อยู่ คำสั่งซื้อ และข้อมูลการใช้งาน พร้อมเหตุผลในการเก็บ</p>
        </section>

        <section className="mt-12" aria-labelledby="privacy-cookies">
          <h2 id="privacy-cookies" className="text-headline font-semibold tracking-tight">คุกกี้และเครื่องมือที่ใช้</h2>
          <p className="mt-3 leading-8 text-muted-foreground">{PLACEHOLDER} อธิบายวัตถุประสงค์ของคุกกี้และเครื่องมือแต่ละหมวด</p>
          <dl className="mt-4 grid gap-4">
            {toolCategories.map(category => (
              <div key={category.name} className="rounded-surface border p-4">
                <dt className="text-title font-medium">{category.name}</dt>
                <dd className="mt-1 text-sm leading-7 text-muted-foreground">{category.tools}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="mt-12" aria-labelledby="privacy-ads">
          <h2 id="privacy-ads" className="text-headline font-semibold tracking-tight">ข้อมูลที่ส่งให้แพลตฟอร์มโฆษณา</h2>
          <p className="mt-3 leading-8 text-muted-foreground">{PLACEHOLDER} อธิบายข้อมูลที่ส่งให้ Meta, TikTok และ Google Ads เมื่อคุณยินยอมหมวดการตลาด</p>
        </section>

        <section className="mt-12" aria-labelledby="privacy-retention">
          <h2 id="privacy-retention" className="text-headline font-semibold tracking-tight">ระยะเวลาการเก็บรักษา</h2>
          <p className="mt-3 leading-8 text-muted-foreground">{PLACEHOLDER} ระบุระยะเวลาการเก็บรักษาข้อมูลแต่ละประเภท</p>
        </section>

        <section className="mt-12" aria-labelledby="privacy-rights">
          <h2 id="privacy-rights" className="text-headline font-semibold tracking-tight">สิทธิของเจ้าของข้อมูล</h2>
          <p className="mt-3 leading-8 text-muted-foreground">{PLACEHOLDER} อธิบายสิทธิในการเข้าถึง แก้ไข ลบ และถอนความยินยอม</p>
        </section>

        <section className="mt-12" aria-labelledby="privacy-contact">
          <h2 id="privacy-contact" className="text-headline font-semibold tracking-tight">ติดต่อเรา</h2>
          <p className="mt-3 leading-8 text-muted-foreground">{PLACEHOLDER} ระบุช่องทางติดต่อเรื่องข้อมูลส่วนบุคคล</p>
        </section>
      </article>
    </div>
  )
}
