import { Badge } from '@workspace/ui/components/badge'
import type { MarketingCampaign } from '@/lib/marketing/api'

const verdicts = {
  profit: { label: 'กำไร', variant: 'success' },
  breakeven: { label: 'เท่าทุน', variant: 'warning' },
  loss: { label: 'ขาดทุน', variant: 'destructive' },
  no_sales: { label: 'ยังไม่มียอดขาย', variant: 'secondary' },
} as const

export function VerdictBadge({ verdict }: { verdict: MarketingCampaign['verdict'] }) {
  if (!verdict) return <span className="text-muted-foreground">—</span>
  const { label, variant } = verdicts[verdict]
  return <Badge variant={variant}>{label}</Badge>
}
