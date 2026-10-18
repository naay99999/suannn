import { readFile } from 'node:fs/promises'
import fontkit from '@pdf-lib/fontkit'
import { PDFDocument, rgb, degrees, type PDFFont, type PDFPage } from 'pdf-lib'
import type { ReceiptSnapshot } from './types'

const pageWidth = 595.28
const pageHeight = 841.89
const margin = 40
const contentWidth = pageWidth - margin * 2
const bodySize = 10
const leading = 14
const footerReserve = 40

const fontUrls = {
  regular: new URL('../../../assets/fonts/Sarabun-Regular.ttf', import.meta.url),
  bold: new URL('../../../assets/fonts/Sarabun-Bold.ttf', import.meta.url),
}
let fontBytes: Promise<{ regular: Uint8Array; bold: Uint8Array }> | undefined

function loadFontBytes() {
  fontBytes ??= Promise.all([
    readFile(fontUrls.regular),
    readFile(fontUrls.bold),
  ]).then(([regular, bold]) => ({ regular, bold }))
  fontBytes.catch(() => { fontBytes = undefined })
  return fontBytes
}

const black = rgb(0.1, 0.1, 0.1)
const grey = rgb(0.45, 0.45, 0.45)
const rule = rgb(0.75, 0.75, 0.75)

export function formatBaht(satang: number) {
  const sign = satang < 0 ? '-' : ''
  const absolute = Math.abs(Math.trunc(satang))
  const whole = Math.floor(absolute / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${sign}${whole}.${(absolute % 100).toString().padStart(2, '0')}`
}

function thaiDate(iso: string) {
  return new Date(iso).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'long' })
}

function branchLabel(branch: string) {
  return branch === '00000' ? 'สำนักงานใหญ่' : `สาขาที่ ${branch}`
}

function joinAddress(parts: Array<string | null | undefined>) {
  return parts.filter((part): part is string => Boolean(part && part.trim())).join(' ')
}

function addressText(value: {
  addressLine1: string; addressLine2: string | null; subdistrict: string; district: string; province: string; postalCode: string
}) {
  return joinAddress([value.addressLine1, value.addressLine2, value.subdistrict, value.district, value.province, value.postalCode])
}

const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('th', { granularity: 'word' }) : null

// Thai has no spaces, so break on word segments and fall back to grapheme breaks for words wider than the line.
function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return ['']
  const width = (value: string) => font.widthOfTextAtSize(value, size)
  const tokens = segmenter ? Array.from(segmenter.segment(clean), ({ segment }) => segment) : clean.split(/(?<= )/)
  const lines: string[] = []
  let current = ''
  const push = () => { lines.push(current.trimEnd()); current = '' }
  for (const token of tokens) {
    if (width(current + token) <= maxWidth) {
      current += token
      continue
    }
    if (current.trim()) push()
    if (width(token) <= maxWidth) {
      current = token.trimStart()
      continue
    }
    const graphemes = Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(token), ({ segment }) => segment)
    for (const grapheme of graphemes) {
      if (width(current + grapheme) > maxWidth && current) push()
      current += grapheme
    }
  }
  if (current.trim()) push()
  return lines.length ? lines : ['']
}

class Writer {
  page!: PDFPage
  y = 0

  constructor(
    private readonly document: PDFDocument,
    readonly regular: PDFFont,
    readonly bold: PDFFont,
    private readonly cancelled: boolean,
  ) {
    this.addPage()
  }

  addPage() {
    this.page = this.document.addPage([pageWidth, pageHeight])
    this.y = pageHeight - margin
    if (this.cancelled) this.watermark()
  }

  ensure(height: number) {
    if (this.y - height < margin + footerReserve) this.addPage()
  }

  text(value: string, x: number, options: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb> } = {}) {
    this.page.drawText(value, {
      x, y: this.y - (options.size ?? bodySize), size: options.size ?? bodySize,
      font: options.bold ? this.bold : this.regular, color: options.color ?? black,
    })
  }

  right(value: string, rightEdge: number, options: { size?: number; bold?: boolean } = {}) {
    const font = options.bold ? this.bold : this.regular
    this.text(value, rightEdge - font.widthOfTextAtSize(value, options.size ?? bodySize), options)
  }

  centered(value: string, options: { size: number; bold?: boolean }) {
    const font = options.bold ? this.bold : this.regular
    this.text(value, (pageWidth - font.widthOfTextAtSize(value, options.size)) / 2, options)
  }

  paragraph(value: string, x: number, maxWidth: number, options: { bold?: boolean; color?: ReturnType<typeof rgb> } = {}) {
    for (const line of wrap(value, options.bold ? this.bold : this.regular, bodySize, maxWidth)) {
      this.ensure(leading)
      this.text(line, x, options)
      this.y -= leading
    }
  }

  line() {
    this.page.drawLine({ start: { x: margin, y: this.y }, end: { x: pageWidth - margin, y: this.y }, thickness: 0.5, color: rule })
  }

  private watermark() {
    const size = 110
    const word = 'ยกเลิก'
    const textWidth = this.bold.widthOfTextAtSize(word, size)
    const angle = 40
    const radians = (angle * Math.PI) / 180
    // Rotation is around the draw origin, so offset to keep the word centred on the page.
    this.page.drawText(word, {
      x: pageWidth / 2 - (textWidth / 2) * Math.cos(radians),
      y: pageHeight / 2 - (textWidth / 2) * Math.sin(radians),
      size, font: this.bold, color: rgb(0.85, 0.15, 0.15), opacity: 0.3, rotate: degrees(angle),
    })
  }
}

export async function renderReceiptPdf(snapshot: ReceiptSnapshot, status: 'issued' | 'cancelled'): Promise<Uint8Array> {
  const bytes = await loadFontBytes()
  const document = await PDFDocument.create()
  document.registerFontkit(fontkit)
  const regular = await document.embedFont(bytes.regular, { subset: true })
  const bold = await document.embedFont(bytes.bold, { subset: true })
  const writer = new Writer(document, regular, bold, status === 'cancelled')
  const vat = snapshot.kind === 'abbreviated_tax_invoice'
  const right = pageWidth - margin

  document.setTitle(snapshot.receiptNumber)
  document.setProducer('suannn')

  writer.centered(vat ? 'ใบเสร็จรับเงิน/ใบกำกับภาษีอย่างย่อ' : 'ใบเสร็จรับเงิน', { size: 20, bold: true })
  writer.y -= 34

  // Seller (left) and receipt identification (right).
  const columnWidth = contentWidth / 2 - 10
  const top = writer.y
  const seller = snapshot.seller
  writer.paragraph(seller.name, margin, columnWidth, { bold: true })
  writer.paragraph(joinAddress([seller.addressLine1, seller.addressLine2, seller.subdistrict, seller.district, seller.province, seller.postalCode]), margin, columnWidth)
  if (seller.phone) writer.paragraph(`โทร ${seller.phone}`, margin, columnWidth)
  writer.paragraph(`เลขประจำตัวผู้เสียภาษี ${seller.taxId} (${branchLabel(seller.branch)})`, margin, columnWidth)
  const afterSeller = writer.y

  writer.y = top
  const meta: Array<[string, string]> = [
    ['เลขที่ใบเสร็จ', snapshot.receiptNumber],
    ['วันที่', thaiDate(snapshot.issuedAt)],
    ['เลขที่คำสั่งซื้อ', snapshot.orderNumber],
  ]
  for (const [label, value] of meta) {
    writer.text(label, margin + contentWidth / 2 + 10, { color: grey })
    writer.right(value, right, { bold: true })
    writer.y -= leading
  }
  writer.y = Math.min(afterSeller, writer.y) - 10

  writer.line()
  writer.y -= 10
  writer.text('ลูกค้า', margin, { bold: true })
  writer.y -= leading
  writer.paragraph(snapshot.billing.name, margin, contentWidth)
  writer.paragraph(addressText(snapshot.billing), margin, contentWidth)
  writer.paragraph(`โทร ${snapshot.billing.phone}`, margin, contentWidth)
  writer.y -= 8

  // Line table.
  const qtyRight = margin + contentWidth * 0.62
  const priceRight = margin + contentWidth * 0.82
  const totalRight = right
  const nameWidth = qtyRight - margin - 60
  const header = () => {
    writer.ensure(leading * 2)
    writer.text('รายการ', margin, { bold: true })
    writer.right('จำนวน', qtyRight, { bold: true })
    writer.right('ราคาต่อหน่วย', priceRight, { bold: true })
    writer.right('รวม (บาท)', totalRight, { bold: true })
    writer.y -= leading + 2
    writer.line()
    writer.y -= 6
  }
  header()
  for (const line of snapshot.lines) {
    const label = [line.productName, line.variantName].filter(Boolean).join(' ')
    const name = `${label}${line.vatTreatment === 'exempt' ? ' (ยกเว้น VAT)' : ''}`
    const wrapped = wrap(name, regular, bodySize, nameWidth)
    if (writer.y - wrapped.length * leading < margin + footerReserve) {
      writer.addPage()
      header()
    }
    wrapped.forEach((part, index) => {
      writer.text(part, margin)
      if (index === 0) {
        writer.right(`${line.quantity} ${line.unit}`, qtyRight)
        writer.right(formatBaht(line.unitPriceSatang), priceRight)
        writer.right(formatBaht(line.lineTotalSatang), totalRight)
      }
      writer.y -= leading
    })
  }
  writer.y -= 2
  writer.line()
  writer.y -= 8

  // Totals.
  const totals = snapshot.totals
  const subtotal = snapshot.lines.reduce((sum, line) => sum + line.lineTotalSatang, 0)
  const rows: Array<[string, number, boolean?]> = [
    ['ราคาสินค้า', subtotal],
    ['ค่าจัดส่ง', snapshot.shippingSatang],
  ]
  if (vat) {
    rows.push(
      ['สินค้ายกเว้นภาษีมูลค่าเพิ่ม', totals.exemptSatang],
      ['มูลค่าก่อน VAT', totals.preVatSatang],
      [`ภาษีมูลค่าเพิ่ม ${totals.vatRateBasisPoints / 100}%`, totals.vatSatang],
    )
  }
  rows.push(['ยอดรวม', totals.totalSatang, true])
  writer.ensure(rows.length * (leading + 2) + 60)
  for (const [label, amount, emphasised] of rows) {
    writer.text(label, margin + contentWidth * 0.45, { bold: emphasised, size: emphasised ? 12 : bodySize })
    writer.right(formatBaht(amount), totalRight, { bold: emphasised, size: emphasised ? 12 : bodySize })
    writer.y -= leading + 2
  }
  if (vat) {
    writer.y -= 4
    writer.text('ราคาสินค้ารวมภาษีมูลค่าเพิ่มแล้ว', margin, { color: grey })
    writer.y -= leading
  }
  writer.y -= 6
  writer.text(`ช่องทางชำระเงิน: ${snapshot.paymentMethod === 'cod' ? 'เก็บเงินปลายทาง' : 'ชำระออนไลน์'}`, margin)

  return document.save()
}
