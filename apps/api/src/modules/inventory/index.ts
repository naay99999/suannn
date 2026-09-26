import { Elysia } from 'elysia'
import type { AppConfig } from '../../config/env'
import { createAuthMacros } from '../../plugins/auth'
import type { Auth } from '../../plugins/auth/auth'
import { createBrowserMutationPlugin } from '../../plugins/browser-mutation'
import { createRequestContextPlugin } from '../../plugins/request-context'
import { DomainError } from '../../shared/domain-error'
import { httpModels } from '../../shared/http-model'
import type { InventoryService } from './service'
import { inventoryModels } from './model'
import type {
  CommandContext,
  CountAdjustmentInput,
  LotQuery,
  MovementQuery,
  ReceiveLotInput,
  ReserveInput,
  WriteOffInput,
} from './types'

function inventoryCommandContext(
  userId: string,
  requestContext: { requestId: string; clientIp: string; userAgent: string | null },
  headers: { 'idempotency-key': string },
): CommandContext {
  return {
    actor: {
      kind: 'staff',
      userId,
      auditContext: {
        requestId: requestContext.requestId,
        ipAddress: requestContext.clientIp,
        userAgent: requestContext.userAgent,
      },
    },
    idempotencyKey: headers['idempotency-key'],
  }
}

function rejectUnknownQueryFields(allowed: readonly string[]) {
  const allowedFields = new Set(allowed)
  return ({ request, set }: { request: Request; set: { status?: number | string } }) => {
    for (const key of new URL(request.url).searchParams.keys()) {
      if (!allowedFields.has(key)) {
        set.status = 422
        return { code: 'VALIDATION_ERROR', message: 'Request validation failed' }
      }
    }
  }
}

function parseStrictJsonBody(
  allowed: readonly string[],
  nested: Record<string, readonly string[]> = {},
) {
  const allowedFields = new Set(allowed)
  return async ({ request }: { request: Request }) => {
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some((key) => !allowedFields.has(key))) {
      throw new DomainError('INVALID_INVENTORY_COMMAND')
    }
    const record = body as Record<string, unknown>
    for (const [property, fields] of Object.entries(nested)) {
      const children = record[property]
      if (!Array.isArray(children) || children.some((child) => !child || typeof child !== 'object'
        || Array.isArray(child) || Object.keys(child).some((key) => !fields.includes(key)))) {
        throw new DomainError('INVALID_INVENTORY_COMMAND')
      }
    }
    return body
  }
}

export function createAdminInventoryModule(config: AppConfig, auth: Auth, service: InventoryService) {
  const staffSecurity = [{ sessionCookie: [] }]
  const readErrors = { 401: 'http.error', 403: 'http.error', 404: 'http.error', 422: 'http.error' } as const
  const mutationErrors = { 401: 'http.error', 403: 'http.error', 404: 'http.error', 409: 'http.error', 422: 'http.error' } as const

  return new Elysia({ name: 'admin-inventory', prefix: '/api/v1/admin/inventory' })
    .use(createBrowserMutationPlugin(config))
    .use(createRequestContextPlugin(config))
    .use(createAuthMacros(auth))
    .model(httpModels)
    .model(inventoryModels)
    .get('/warehouses', () => service.getDefaultWarehouse(), {
      permission: { inventory: ['read'] },
      response: { 200: 'inventory.warehouse', ...readErrors },
      detail: {
        summary: 'Get the default inventory warehouse',
        description: 'Returns the default MAIN warehouse. Requires inventory:read permission.',
        tags: ['Admin Inventory'], security: staffSecurity,
      },
    })
    .get('/variants/:variantId/summary', async ({ params }) => {
      const warehouse = await service.getDefaultWarehouse()
      return service.getVariantSummary(params.variantId, warehouse.id)
    }, {
      permission: { inventory: ['read'] },
      params: 'inventory.variantParams',
      response: { 200: 'inventory.variantSummary', ...readErrors },
      detail: {
        summary: 'Get stock totals for a variant',
        description: 'Returns physical, held, eligible, and sellable totals in the default warehouse. Requires inventory:read permission.',
        tags: ['Admin Inventory'], security: staffSecurity,
      },
    })
    .get('/lots', ({ query }) => service.listLots(query as LotQuery), {
      beforeHandle: rejectUnknownQueryFields(['warehouseId', 'variantId', 'limit', 'cursor']),
      permission: { inventory: ['read'] },
      query: 'inventory.lotQuery',
      response: { 200: 'inventory.lotPage', ...readErrors },
      detail: {
        summary: 'List inventory lots',
        description: 'Lists physical lots, including quarantined, expired, and depleted stock. Requires inventory:read permission.',
        tags: ['Admin Inventory'], security: staffSecurity,
      },
    })
    .get('/lots/:lotId', ({ params }) => service.getLot(params.lotId), {
      permission: { inventory: ['read'] },
      params: 'inventory.lotParams',
      response: { 200: 'inventory.lot', ...readErrors },
      detail: {
        summary: 'Get an inventory lot',
        description: 'Returns physical, reserved, and sellable quantities for one lot. Requires inventory:read permission.',
        tags: ['Admin Inventory'], security: staffSecurity,
      },
    })
    .get('/movements', ({ query }) => service.listMovements(query as MovementQuery), {
      beforeHandle: rejectUnknownQueryFields(['warehouseId', 'variantId', 'lotId', 'limit', 'cursor']),
      permission: { inventory: ['read'] },
      query: 'inventory.movementQuery',
      response: { 200: 'inventory.movementPage', ...readErrors },
      detail: {
        summary: 'List stock movements',
        description: 'Lists immutable physical stock history in deterministic cursor order. Requires inventory:read permission.',
        tags: ['Admin Inventory'], security: staffSecurity,
      },
    })
    .post('/lots', ({ body, user, requestContext, headers, set }) => {
      set.status = 201
      return service.receiveLot(
        body as ReceiveLotInput,
        inventoryCommandContext(user.id, requestContext, headers),
      )
    }, {
      parse: [parseStrictJsonBody([
        'warehouseId', 'variantId', 'lotCode', 'quantity', 'expiryDate', 'receivedAt', 'quarantined', 'quarantineReason',
      ]), 'json'],
      browserMutation: 'admin',
      permission: { inventory: ['adjust'] },
      headers: 'inventory.idempotencyHeaders',
      body: 'inventory.receiveBody',
      response: { 201: 'inventory.lot', ...mutationErrors },
      detail: {
        summary: 'Receive an inventory lot',
        description: 'Creates a traceable lot and receipt movement. Requires inventory:adjust permission, an idempotency key, and an admin-origin browser request.',
        tags: ['Admin Inventory'], security: staffSecurity,
      },
    })
    .post('/lots/:lotId/quarantine', ({ params, body, user, requestContext, headers }) => service.quarantineLot(
      params.lotId,
      body.reason,
      inventoryCommandContext(user.id, requestContext, headers),
    ), {
      parse: [parseStrictJsonBody(['reason']), 'json'],
      browserMutation: 'admin',
      permission: { inventory: ['adjust'] },
      params: 'inventory.lotParams',
      headers: 'inventory.idempotencyHeaders',
      body: 'inventory.quarantineBody',
      response: { 200: 'inventory.lot', ...mutationErrors },
      detail: {
        summary: 'Quarantine an inventory lot',
        description: 'Quarantines the lot and cancels reservations that use it. Requires inventory:adjust permission, an idempotency key, and an admin-origin browser request.',
        tags: ['Admin Inventory'], security: staffSecurity,
      },
    })
    .post('/lots/:lotId/release-quarantine', ({ params, user, requestContext, headers }) => service.releaseQuarantine(
      params.lotId,
      inventoryCommandContext(user.id, requestContext, headers),
    ), {
      parse: [parseStrictJsonBody([]), 'json'],
      browserMutation: 'admin',
      permission: { inventory: ['adjust'] },
      params: 'inventory.lotParams',
      headers: 'inventory.idempotencyHeaders',
      body: 'inventory.emptyBody',
      response: { 200: 'inventory.lot', ...mutationErrors },
      detail: {
        summary: 'Release an inventory lot from quarantine',
        description: 'Releases an unexpired lot from quarantine. Requires inventory:adjust permission, an idempotency key, and an admin-origin browser request.',
        tags: ['Admin Inventory'], security: staffSecurity,
      },
    })
    .post('/lots/:lotId/write-offs', ({ params, body, user, requestContext, headers }) => service.writeOff(
      params.lotId,
      body as WriteOffInput,
      inventoryCommandContext(user.id, requestContext, headers),
    ), {
      parse: [parseStrictJsonBody(['quantity', 'reason', 'note']), 'json'],
      browserMutation: 'admin',
      permission: { inventory: ['adjust'] },
      params: 'inventory.lotParams',
      headers: 'inventory.idempotencyHeaders',
      body: 'inventory.writeOffBody',
      response: { 200: 'inventory.lot', ...mutationErrors },
      detail: {
        summary: 'Write off inventory units',
        description: 'Records a physical loss for spoiled, expired, or damaged units. Requires inventory:adjust permission, an idempotency key, and an admin-origin browser request.',
        tags: ['Admin Inventory'], security: staffSecurity,
      },
    })
    .post('/lots/:lotId/count-adjustments', ({ params, body, user, requestContext, headers }) => service.adjustCount(
      params.lotId,
      body as CountAdjustmentInput,
      inventoryCommandContext(user.id, requestContext, headers),
    ), {
      parse: [parseStrictJsonBody(['countedQuantity', 'reason']), 'json'],
      browserMutation: 'admin',
      permission: { inventory: ['adjust'] },
      params: 'inventory.lotParams',
      headers: 'inventory.idempotencyHeaders',
      body: 'inventory.countAdjustmentBody',
      response: { 200: 'inventory.lot', ...mutationErrors },
      detail: {
        summary: 'Reconcile an inventory count',
        description: 'Sets a lot to the staff-counted physical quantity. Requires inventory:adjust permission, an idempotency key, and an admin-origin browser request.',
        tags: ['Admin Inventory'], security: staffSecurity,
      },
    })
    .post('/reservations', ({ body, user, requestContext, headers, set }) => {
      set.status = 201
      return service.reserve(
        body as ReserveInput,
        inventoryCommandContext(user.id, requestContext, headers),
      )
    }, {
      parse: [parseStrictJsonBody(['warehouseId', 'lines', 'externalReference'], { lines: ['variantId', 'quantity'] }), 'json'],
      browserMutation: 'admin',
      permission: { inventory: ['adjust'] },
      headers: 'inventory.idempotencyHeaders',
      body: 'inventory.reserveBody',
      response: { 201: 'inventory.reservation', ...mutationErrors },
      detail: {
        summary: 'Reserve inventory units',
        description: 'Creates an all-or-nothing 15-minute hold using FIFO lot allocation. Requires inventory:adjust permission, an idempotency key, and an admin-origin browser request.',
        tags: ['Admin Inventory'], security: staffSecurity,
      },
    })
    .get('/reservations/:reservationId', ({ params }) => service.getReservation(params.reservationId), {
      permission: { inventory: ['read'] },
      params: 'inventory.reservationParams',
      response: { 200: 'inventory.reservation', ...readErrors },
      detail: {
        summary: 'Get an inventory reservation',
        description: 'Returns reservation status and its lot allocations. Requires inventory:read permission.',
        tags: ['Admin Inventory'], security: staffSecurity,
      },
    })
    .post('/reservations/:reservationId/confirm', ({ params, user, requestContext, headers }) => service.confirm(
      params.reservationId,
      inventoryCommandContext(user.id, requestContext, headers),
    ), {
      parse: [parseStrictJsonBody([]), 'json'],
      browserMutation: 'admin',
      permission: { inventory: ['adjust'] },
      params: 'inventory.reservationParams',
      headers: 'inventory.idempotencyHeaders',
      body: 'inventory.emptyBody',
      response: { 200: 'inventory.reservation', ...mutationErrors },
      detail: {
        summary: 'Confirm an inventory reservation',
        description: 'Consumes the physical units held by an active reservation. Requires inventory:adjust permission, an idempotency key, and an admin-origin browser request.',
        tags: ['Admin Inventory'], security: staffSecurity,
      },
    })
    .post('/reservations/:reservationId/release', ({ params, user, requestContext, headers }) => service.release(
      params.reservationId,
      inventoryCommandContext(user.id, requestContext, headers),
    ), {
      parse: [parseStrictJsonBody([]), 'json'],
      browserMutation: 'admin',
      permission: { inventory: ['adjust'] },
      params: 'inventory.reservationParams',
      headers: 'inventory.idempotencyHeaders',
      body: 'inventory.emptyBody',
      response: { 200: 'inventory.reservation', ...mutationErrors },
      detail: {
        summary: 'Release an inventory reservation',
        description: 'Releases held units from an active reservation. Requires inventory:adjust permission, an idempotency key, and an admin-origin browser request.',
        tags: ['Admin Inventory'], security: staffSecurity,
      },
    })
}

export * from './model'
export * from './service'
export * from './types'
