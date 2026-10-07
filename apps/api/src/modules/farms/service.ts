import type { FarmRepository } from './repository'
import type { ProductRepository } from '../products/repository'
import { normalizeFarmCreate, normalizeFarmUpdate } from './policy'
import type { CreateFarmInput, FarmActor, FarmListQuery, AdminFarmQuery, UpdateFarmInput } from './types'

export class FarmService {
  constructor(private readonly repository: FarmRepository, private readonly products?: ProductRepository) {}
  listStore(query: FarmListQuery) { return this.repository.listStore(query) }
  getStoreBySlug(slug: string) { return this.repository.getStoreBySlug(slug) }
  listAdmin(query: AdminFarmQuery) { return this.repository.listAdmin(query) }
  getAdminById(id: string) { return this.repository.getAdminById(id) }
  createFarm(input: CreateFarmInput, actor: FarmActor) { return this.repository.createFarm(normalizeFarmCreate(input), actor) }
  updateFarm(id: string, input: UpdateFarmInput, actor: FarmActor) { return this.repository.updateFarm(id, normalizeFarmUpdate(input), actor) }
  publishFarm(id: string, actor: FarmActor) { return this.repository.publishFarm(id, actor) }
  unpublishFarm(id: string, actor: FarmActor) { return this.repository.unpublishFarm(id, actor) }
  archiveFarm(id: string, actor: FarmActor) { return this.repository.archiveFarm(id, actor) }
  async listProducts(slug: string, query: FarmListQuery) {
    const farm = await this.repository.getStoreBySlug(slug)
    if (!this.products) throw new Error('FARM_PRODUCT_REPOSITORY_REQUIRED')
    return this.products.listStoreForFarm(farm.id, query)
  }
}
