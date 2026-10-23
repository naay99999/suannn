import { describe, expect, it } from 'bun:test'
import { createApp, type AppDependencies } from '../../src/app'
import { loadConfig } from '../../src/config/env'
import type { CartService } from '../../src/modules/cart/service'
import type { CartDetail } from '../../src/modules/cart/types'
import type { DiscountRepository } from '../../src/modules/discounts/repository'
import { DiscountService } from '../../src/modules/discounts/service'
import type { DiscountRule } from '../../src/modules/discounts/types'
import type { Auth } from '../../src/plugins/auth/auth'
import { testEnv } from '../fixtures'

const config = loadConfig(testEnv)
const ruleId = '00000000-0000-4000-8000-0000000000a1'
const rule: DiscountRule = {
  id: ruleId, code: 'SAVE10', kind: 'percent', version: 1, active: true, percentOff: 10, amountOffSatang: null,
  maxDiscountSatang: null, minSubtotalSatang: null, minQuantity: null, eligibleCategories: [], eligibleProductIds: [],
  startsAt: null, endsAt: null, usageLimit: null, perCustomerLimit: null, allowedEmails: [], firstOrderOnly: false,
}

function createHarness(options: { denyAfter?: number } = {}) {
  let attached: string | null = null
  let limiterCalls = 0
  const limiterInputs: unknown[] = []
  const lines: CartDetail['lines'] = [{
    variantId: '00000000-0000-4000-8000-000000000002', productId: '00000000-0000-4000-8000-000000000003',
    productSlug: 'a', productName: 'A', productImageUrl: null, productImageAlt: null, variantName: 'v', unit: 'kg',
    quantity: 2, priceSatang: 10000, canPurchase: true, issues: [], productCategory: 'fresh',
  }]
  const cartService = {
    get: async (): Promise<CartDetail> => ({ cartVersion: 1, lines, discountCodeId: attached }),
    setDiscountCode: async (_principal: unknown, id: string | null): Promise<CartDetail> => {
      attached = id
      return { cartVersion: 2, lines, discountCodeId: attached }
    },
  }
  const repository = {
    getRuleByCode: async (code: string) => (code === 'SAVE10' ? rule : null),
    getRuleById: async (id: string) => (id === ruleId ? rule : null),
    currentUsage: async () => ({ total: 0, byEmail: 0, hasPriorOrder: false }),
    accountEmail: async () => 'customer@example.test',
  }
  const discounts = new DiscountService(
    repository as unknown as DiscountRepository,
    { get: async () => ({ shippingFeeSatang: 5000 }) } as never,
  )
  const auth = {
    handler: async () => new Response(),
    api: {
      generateOpenAPISchema: async () => ({ components: {}, paths: {} }),
      getSession: async () => null,
    },
  } as unknown as Auth
  const dependencies = {
    auth,
    cart: cartService as unknown as CartService,
    discounts,
    staffMfaRequired: async () => true,
    identityReservations: { findState: async () => null },
    limiter: {
      consume: async (input: unknown) => {
        limiterInputs.push(input)
        limiterCalls += 1
        const allowed = limiterCalls <= (options.denyAfter ?? 20)
        return { allowed, remaining: 0, retryAfterSeconds: 60, resetAt: new Date('2026-09-27T00:01:00Z') }
      },
    },
  } as unknown as AppDependencies
  return { app: createApp(config, dependencies), limiterInputs, attached: () => attached }
}

function put(code: string) {
  return new Request('http://localhost/api/v1/store/cart/discount', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', origin: config.storefrontUrl },
    body: JSON.stringify({ code }),
  })
}

describe('store cart discount routes', () => {
  it('rejects an unknown code with 422 DISCOUNT_CODE_REJECTED and attaches nothing', async () => {
    const harness = createHarness()
    const response = await (await harness.app).handle(put('nope'))
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ code: 'DISCOUNT_CODE_REJECTED', reason: 'unknown' })
    expect(harness.attached()).toBeNull()
  })

  it('attaches a valid code and returns the cart with its discount', async () => {
    const harness = createHarness()
    const response = await (await harness.app).handle(put(' save10 '))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      cartVersion: 2,
      discount: { code: 'SAVE10', status: 'applied', itemDiscountSatang: 2000, freeShipping: false },
    })
    expect(harness.attached()).toBe(ruleId)
    expect(harness.limiterInputs[0]).toMatchObject({
      namespace: 'discount-apply', subjectHash: 'discount-apply', limit: 20, windowSeconds: 600,
    })
  })

  it('answers 429 on the 21st apply in the window', async () => {
    const harness = createHarness({ denyAfter: 20 })
    const app = await harness.app
    for (let i = 0; i < 20; i += 1) expect((await app.handle(put('SAVE10'))).status).toBe(200)
    const response = await app.handle(put('SAVE10'))
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBeTruthy()
  })

  it('removes the code with DELETE and returns discount null', async () => {
    const harness = createHarness()
    const app = await harness.app
    await app.handle(put('SAVE10'))
    const response = await app.handle(new Request('http://localhost/api/v1/store/cart/discount', {
      method: 'DELETE', headers: { 'content-type': 'application/json', origin: config.storefrontUrl },
    }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ discount: null })
    expect(harness.attached()).toBeNull()
  })

  it('includes discount in the plain cart response', async () => {
    const harness = createHarness()
    const response = await (await harness.app).handle(new Request('http://localhost/api/v1/store/cart'))
    expect(await response.json()).toMatchObject({ discount: null })
  })
})
