import type { DashboardOverview } from './model'
import type { DashboardRepository } from './repository'

export const dashboardRangeDays = { '7d': 7, '30d': 30, '90d': 90 } as const
export type DashboardRange = keyof typeof dashboardRangeDays

const dayMs = 86_400_000
// Asia/Bangkok is UTC+7 with no daylight saving time.
const bangkokOffsetMs = 7 * 60 * 60 * 1000
const recentOrderLimit = 8

function bangkokDate(ms: number) {
  return new Date(ms + bangkokOffsetMs).toISOString().slice(0, 10)
}

export class DashboardService {
  constructor(
    private readonly repository: Pick<DashboardRepository, 'dailySales' | 'backlogCounts' | 'recentOrders'>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async overview(range: DashboardRange): Promise<DashboardOverview> {
    const days = dashboardRangeDays[range]
    const todayStart = Math.floor((this.now().getTime() + bangkokOffsetMs) / dayMs) * dayMs - bangkokOffsetMs
    const to = todayStart + dayMs
    const from = to - days * dayMs
    const previousFrom = from - days * dayMs

    const [sales, backlogRows, recent] = await Promise.all([
      this.repository.dailySales(new Date(previousFrom), new Date(to)),
      this.repository.backlogCounts(),
      this.repository.recentOrders(recentOrderLimit),
    ])

    const salesByDate = new Map(sales.map((row) => [row.date, row]))
    const daily = Array.from({ length: days }, (_, index) => {
      const date = bangkokDate(from + index * dayMs)
      const row = salesByDate.get(date)
      return { date, orderCount: row?.orderCount ?? 0, revenueSatang: row?.revenueSatang ?? 0 }
    })
    const firstDate = bangkokDate(from)
    const previous = sales.filter((row) => row.date < firstDate)
    const revenueSatang = daily.reduce((sum, row) => sum + row.revenueSatang, 0)
    const orderCount = daily.reduce((sum, row) => sum + row.orderCount, 0)
    const backlog = new Map(backlogRows.map((row) => [row.status, row.count]))

    return {
      range,
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
      summary: {
        revenueSatang,
        previousRevenueSatang: previous.reduce((sum, row) => sum + row.revenueSatang, 0),
        orderCount,
        previousOrderCount: previous.reduce((sum, row) => sum + row.orderCount, 0),
        averageOrderValueSatang: orderCount === 0 ? 0 : Math.round(revenueSatang / orderCount),
      },
      backlog: {
        pendingPayment: backlog.get('pending_payment') ?? 0,
        placed: backlog.get('placed') ?? 0,
        processing: backlog.get('processing') ?? 0,
        packed: backlog.get('packed') ?? 0,
      },
      daily,
      recentOrders: recent.map((order) => ({ ...order, createdAt: order.createdAt.toISOString() })),
    }
  }
}
