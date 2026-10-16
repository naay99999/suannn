import { useState } from 'react'
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation } from 'react-router'
import { Button } from '@workspace/ui/components/button'
import { Field, FieldLabel } from '@workspace/ui/components/field'
import { Input } from '@workspace/ui/components/input'
import { ServerDataTable, type ServerDataTableFeatures } from '@/components/server-data-table'
import { useCursorPagination } from '@/hooks/use-cursor-pagination'
import { auditActionLabel, auditApi, formatAuditMetadata, type AuditEvent, type AuditListInput } from '@/lib/audit/api'
import { auditEventsQuery } from '@/lib/audit/queries'
import { authSessionQuery } from '@/lib/auth-session'
import { formatTimestamp } from '@/lib/format'
import { hasPermission } from '@/lib/permissions'

const auditFilters = ['actorUserId'] as const
const emptyEvents: AuditEvent[] = []
const column = createColumnHelper<ServerDataTableFeatures, AuditEvent>()

function auditColumns(actorName: (id: string) => string | undefined): ColumnDef<ServerDataTableFeatures, AuditEvent>[] {
  return column.columns([
    column.accessor('occurredAt', {
      header: 'เวลา',
      cell: ({ getValue }) => <span className="whitespace-nowrap">{formatTimestamp(getValue())}</span>,
    }),
    column.accessor('action', {
      header: 'กิจกรรม',
      cell: ({ row }) => (
        <div className="flex min-w-40 flex-col gap-0.5">
          <span className="font-medium">{auditActionLabel(row.original.action)}</span>
          <span className="font-mono text-xs text-muted-foreground">{row.original.action}</span>
        </div>
      ),
    }),
    column.accessor('actorUserId', {
      header: 'ผู้ดำเนินการ',
      cell: ({ getValue }) => {
        const id = getValue()
        if (!id) return <span className="text-muted-foreground">ระบบ</span>
        const name = actorName(id)
        return (
          <div className="flex flex-col gap-0.5">
            {name && <span>{name}</span>}
            <span className="font-mono text-xs text-muted-foreground">{id}</span>
          </div>
        )
      },
    }),
    column.accessor('targetId', {
      header: 'เป้าหมาย',
      cell: ({ row }) => (
        <div className="flex flex-col gap-0.5">
          <span>{row.original.targetType}</span>
          <span className="font-mono text-xs text-muted-foreground">{row.original.targetId}</span>
        </div>
      ),
    }),
    column.accessor('metadata', {
      header: 'รายละเอียด',
      cell: ({ row }) => {
        const entries = Object.entries(row.original.metadata)
        return (
          <div className="flex min-w-48 flex-col gap-1 text-xs">
            {entries.length > 0 && <dl className="grid gap-0.5">
              {entries.map(([key, value]) => <div className="flex gap-1" key={key}>
                <dt className="font-medium">{key}:</dt>
                <dd className="break-all text-muted-foreground">{formatAuditMetadata(value)}</dd>
              </div>)}
            </dl>}
            <span className="text-muted-foreground">Request {row.original.requestId}</span>
          </div>
        )
      },
    }),
  ])
}

export function Component() {
  const location = useLocation()
  const queryClient = useQueryClient()
  const session = queryClient.getQueryData(authSessionQuery.queryKey)
  const canReadStaff = hasPermission(session, 'staff:read')
  const { cursor, limit, canPrevious, next, previous, first, setLimit, setFilters } = useCursorPagination(auditFilters)
  const actorUserId = new URLSearchParams(location.search).get('actorUserId') ?? ''
  const [draft, setDraft] = useState({ source: actorUserId, value: actorUserId })
  const actorDraft = draft.source === actorUserId ? draft.value : actorUserId
  const query: AuditListInput = { actorUserId: actorUserId || undefined, limit, cursor }
  const events = useQuery(auditEventsQuery(query))
  const staff = useQuery({ queryKey: ['audit', 'staff-names'], queryFn: () => auditApi.staffMembers(), enabled: canReadStaff, staleTime: 60_000 })
  const staffNames = new Map((staff.data?.items ?? []).map((member) => [member.id, member.name || member.email]))
  const filteredName = actorUserId ? staffNames.get(actorUserId) : undefined

  return (
    <section className="flex flex-col gap-6 px-4 lg:px-6">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-muted-foreground">ความปลอดภัย</p>
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-semibold tracking-tight">บันทึกกิจกรรม</h1>
          <p className="text-muted-foreground">ประวัติการเปลี่ยนแปลงของเจ้าหน้าที่ ลูกค้า และระบบ เรียงจากล่าสุด</p>
        </div>
      </div>
      <form
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={(event) => {
          event.preventDefault()
          setFilters({ actorUserId: actorDraft })
        }}
      >
        <Field className="sm:max-w-md">
          <FieldLabel htmlFor="audit-actor-filter">รหัสผู้ดำเนินการ</FieldLabel>
          <Input id="audit-actor-filter" onChange={(event) => setDraft({ source: actorUserId, value: event.target.value })} placeholder="User ID" value={actorDraft} />
        </Field>
        <div className="flex gap-2">
          <Button type="submit">กรอง</Button>
          {actorUserId && <Button onClick={() => setFilters({ actorUserId: undefined })} type="button" variant="outline">ล้างตัวกรอง</Button>}
        </div>
      </form>
      {filteredName && <p className="text-sm text-muted-foreground" role="status">แสดงเฉพาะกิจกรรมของ {filteredName}</p>}
      <ServerDataTable
        columns={auditColumns((id) => staffNames.get(id))}
        data={events.data?.items ?? emptyEvents}
        emptyDescription={actorUserId ? 'ไม่พบกิจกรรมของผู้ใช้นี้' : 'กิจกรรมใหม่จะแสดงที่นี่'}
        emptyTitle="ยังไม่มีบันทึกกิจกรรม"
        error={events.error}
        getRowId={(event) => event.id}
        isPending={events.isPending}
        isRefreshing={events.isFetching && !events.isPending}
        onRetry={() => void events.refetch()}
        pagination={{
          limit,
          nextCursor: events.data?.nextCursor ?? null,
          canPrevious,
          hasCursor: Boolean(cursor),
          onNext: next,
          onPrevious: previous,
          onFirst: first,
          onLimitChange: setLimit,
        }}
      />
    </section>
  )
}
