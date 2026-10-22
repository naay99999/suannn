import { useQuery } from '@tanstack/react-query'
import { ArrowDown01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@workspace/ui/components/collapsible'
import { QueryState } from '@/components/query-state'
import { CopyRow } from '@/components/copy-button'
import { platformLabel } from '@/lib/marketing/format'
import { marketingTemplatesQuery } from '@/lib/marketing/queries'

export function UtmTemplates() {
  const templates = useQuery(marketingTemplatesQuery)
  return (
    <Collapsible className="rounded-xl border bg-card">
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 p-4 text-left font-medium">
        ตั้งค่า UTM ในแอดแต่ละแพลตฟอร์ม
        <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} />
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-4 px-4 pb-4">
        {templates.isPending
          ? <QueryState kind="loading" />
          : templates.isError
            ? <QueryState kind="error" message={templates.error.message} onRetry={() => void templates.refetch()} />
            : templates.data.templates.map((item) => (
              <div key={item.platform} className="flex flex-col gap-1">
                <h3 className="text-sm font-medium">{platformLabel(item.platform)}</h3>
                <p className="text-sm text-muted-foreground">{item.where}</p>
                <CopyRow label={`คัดลอกพารามิเตอร์ ${platformLabel(item.platform)}`} value={item.template}>
                  <code className="block break-all rounded-md bg-muted px-2 py-1.5 text-xs">{item.template}</code>
                </CopyRow>
              </div>
            ))}
      </CollapsibleContent>
    </Collapsible>
  )
}
