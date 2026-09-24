import { describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'
import { customerAddressModels } from '../../src/modules/customer/addresses/model'

const address = {
  label: 'Home', recipientName: 'Mali', phone: '0812345678',
  addressLine1: '99 ถนนสุขุมวิท', addressLine2: null,
  subdistrict: 'คลองเตย', district: 'คลองเตย', province: 'กรุงเทพมหานคร',
  postalCode: '10110',
}

describe('customer address request shape', () => {
  const schema = customerAddressModels['customerAddress.createBody']
  const app = new Elysia({ normalize: false }).post('/', ({ body }) => body, { body: schema })
  const status = async (body: unknown) => (await app.handle(new Request('http://localhost/', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }))).status

  it('accepts a Thai address with five postal digits and a ten digit phone', async () => {
    expect(await status(address)).toBe(200)
    expect(await status({ ...address, phone: '021234567' })).toBe(200)
    expect(await status({ ...address, country: 'TH' })).toBe(200)
  })

  it('rejects malformed postal codes and phones', async () => {
    expect(await status({ ...address, postalCode: '1011' })).toBe(422)
    expect(await status({ ...address, phone: '12345678' })).toBe(422)
  })

  it('rejects ownership, default, and non-Thai input', async () => {
    expect(await status({ ...address, userId: 'other' })).toBe(422)
    expect(await status({ ...address, isDefaultShipping: true })).toBe(422)
    expect(await status({ ...address, country: 'US' })).toBe(422)
  })
})
