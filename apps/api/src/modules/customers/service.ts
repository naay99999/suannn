import { DomainError } from '../../shared/domain-error'
import type { AdminCustomerDetail } from './model'
import type { AdminCustomerRepository } from './repository'

const recentOrderLimit = 10

export class AdminCustomerService {
  constructor(private readonly repository: Pick<AdminCustomerRepository, 'findCustomer' | 'orderStats' | 'addresses' | 'recentOrders'>) {}

  async detail(customerId: string): Promise<AdminCustomerDetail> {
    const customer = await this.repository.findCustomer(customerId)
    if (!customer) throw new DomainError('CUSTOMER_NOT_FOUND')

    const [stats, addresses, recent] = await Promise.all([
      this.repository.orderStats(customerId),
      this.repository.addresses(customerId),
      this.repository.recentOrders(customerId, recentOrderLimit),
    ])

    return {
      ...customer,
      banned: customer.banned ?? false,
      createdAt: customer.createdAt.toISOString(),
      stats: {
        orderCount: stats.orderCount,
        spentSatang: stats.spentSatang,
        lastOrderAt: stats.lastOrderAt?.toISOString() ?? null,
      },
      addresses,
      recentOrders: recent.map((order) => ({ ...order, createdAt: order.createdAt.toISOString() })),
    }
  }
}
