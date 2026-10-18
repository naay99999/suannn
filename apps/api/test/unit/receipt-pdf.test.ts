import { describe, expect, it } from 'bun:test'
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib'
import { renderReceiptPdf } from '../../src/modules/receipts/pdf'
import type { ReceiptSnapshot } from '../../src/modules/receipts/types'

function snapshot(overrides: Partial<ReceiptSnapshot> = {}): ReceiptSnapshot {
  return {
    version: 1,
    kind: 'abbreviated_tax_invoice',
    receiptNumber: 'RC2610-00001',
    issuedAt: '2026-10-18T05:00:00.000Z',
    paidAt: '2026-10-18T04:00:00.000Z',
    seller: {
      name: 'บริษัท สวนนานา จำกัด',
      taxId: '0105536092641',
      branch: '00000',
      addressLine1: '99 ถนนสุขุมวิท',
      addressLine2: null,
      subdistrict: 'คลองตัน',
      district: 'คลองเตย',
      province: 'กรุงเทพมหานคร',
      postalCode: '10110',
      phone: '021234567',
    },
    billing: {
      name: 'สมชาย ใจดี',
      phone: '0812345678',
      addressLine1: '12 ซอยสุขสบาย',
      addressLine2: null,
      subdistrict: 'ตลาดน้อย',
      district: 'สัมพันธวงศ์',
      province: 'กรุงเทพมหานคร',
      postalCode: '10100',
    },
    orderNumber: 'SN-20261018-0001',
    paymentMethod: 'stripe',
    lines: [
      { productName: 'มะม่วงน้ำดอกไม้สด', variantName: 'กล่อง', unit: 'กล่อง', quantity: 2, unitPriceSatang: 12000, lineTotalSatang: 24000, vatTreatment: 'exempt' },
      { productName: 'มะม่วงอบแห้ง', variantName: 'ถุง', unit: 'ถุง', quantity: 1, unitPriceSatang: 10700, lineTotalSatang: 10700, vatTreatment: 'standard' },
    ],
    shippingSatang: 725,
    totals: { exemptSatang: 24000, vatableSatang: 11425, vatSatang: 747, preVatSatang: 10678, totalSatang: 35425, vatRateBasisPoints: 700 },
    ...overrides,
  }
}

describe('receipt pdf', () => {
  it('renders a non-empty PDF starting with %PDF-', async () => {
    const bytes = await renderReceiptPdf(snapshot(), 'issued')
    expect(bytes.byteLength).toBeGreaterThan(1000)
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-')
  })

  it('renders Thai text with the embedded font', async () => {
    const bytes = await renderReceiptPdf(snapshot(), 'issued')
    const document = await PDFDocument.load(bytes)
    expect(document.getPageCount()).toBe(1)
    const { width, height } = document.getPage(0).getSize()
    expect(Math.abs(width - 595)).toBeLessThanOrEqual(1)
    expect(Math.abs(height - 842)).toBeLessThanOrEqual(1)
    // Embedded fonts are named Sarabun-Regular or Sarabun-Bold, optionally with a subset tag.
    const fonts = document.context.enumerateIndirectObjects()
      .map(([, object]) => object)
      .filter((object): object is PDFDict => object instanceof PDFDict && object.get(PDFName.of('Type')) === PDFName.of('FontDescriptor'))
    const names = fonts.map((font) => String(font.get(PDFName.of('FontName'))))
    expect(names.length).toBe(2)
    for (const name of names) expect(name).toMatch(/^\/(?:[A-Z]{6}\+)?Sarabun/)
    expect(fonts.every((font) => font.has(PDFName.of('FontFile2')))).toBe(true)
  })

  it('cancelled status adds the ยกเลิก mark', async () => {
    const issued = await renderReceiptPdf(snapshot(), 'issued')
    const cancelled = await renderReceiptPdf(snapshot(), 'cancelled')
    expect(Buffer.compare(Buffer.from(issued), Buffer.from(cancelled))).not.toBe(0)
    expect((await PDFDocument.load(cancelled)).getPageCount()).toBe(1)
  })

  it('handles long names and the receipt kind without VAT block', async () => {
    const long = 'ผลิตภัณฑ์แปรรูปจากผลไม้ตามฤดูกาลชนิดพิเศษคัดเกรดส่งออกบรรจุสุญญากาศ'.repeat(4)
    const lines = Array.from({ length: 60 }, (_, index) => ({
      productName: `${long} ${index}`, variantName: 'x', unit: 'ชิ้น', quantity: 1,
      unitPriceSatang: 1000, lineTotalSatang: 1000, vatTreatment: 'standard' as const,
    }))
    const bytes = await renderReceiptPdf(snapshot({ kind: 'receipt', lines }), 'issued')
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(1)
  })
})
