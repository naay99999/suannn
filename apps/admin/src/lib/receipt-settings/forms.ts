import type { ReceiptSettings, ReceiptSettingsInput } from './api'

export interface ReceiptSettingsFormValues {
  name: string
  taxId: string
  branchKind: 'head-office' | 'branch'
  branchCode: string
  addressLine1: string
  addressLine2: string
  subdistrict: string
  district: string
  province: string
  postalCode: string
  phone: string
}

export const headOfficeBranch = '00000'

export function receiptSettingsToForm(settings: ReceiptSettings | null | undefined): ReceiptSettingsFormValues {
  const branch = settings?.branch ?? null
  return {
    name: settings?.name ?? '',
    taxId: settings?.taxId ?? '',
    branchKind: branch !== null && branch !== headOfficeBranch ? 'branch' : 'head-office',
    branchCode: branch !== null && branch !== headOfficeBranch ? branch : '',
    addressLine1: settings?.addressLine1 ?? '',
    addressLine2: settings?.addressLine2 ?? '',
    subdistrict: settings?.subdistrict ?? '',
    district: settings?.district ?? '',
    province: settings?.province ?? '',
    postalCode: settings?.postalCode ?? '',
    phone: settings?.phone ?? '',
  }
}

export function isValidThaiTaxId(value: string) {
  if (!/^[0-9]{13}$/.test(value)) return false
  let sum = 0
  for (let i = 0; i < 12; i += 1) sum += Number(value[i]) * (13 - i)
  return (11 - (sum % 11)) % 10 === Number(value[12])
}

function nullable(value: string) {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

export function parseReceiptSettings(values: ReceiptSettingsFormValues): ReceiptSettingsInput {
  const taxId = values.taxId.replace(/[\s-]/g, '')
  if (taxId && !isValidThaiTaxId(taxId)) throw new Error('เลขประจำตัวผู้เสียภาษีไม่ถูกต้อง ต้องเป็นตัวเลข 13 หลัก')
  let branch: string | null = headOfficeBranch
  if (values.branchKind === 'branch') {
    branch = values.branchCode.trim()
    if (!/^[0-9]{5}$/.test(branch)) throw new Error('เลขที่สาขาต้องเป็นตัวเลข 5 หลัก')
  }
  const postalCode = nullable(values.postalCode)
  if (postalCode !== null && !/^[0-9]{5}$/.test(postalCode)) throw new Error('รหัสไปรษณีย์ต้องเป็นตัวเลข 5 หลัก')
  return {
    name: nullable(values.name),
    taxId: taxId || null,
    branch,
    addressLine1: nullable(values.addressLine1),
    addressLine2: nullable(values.addressLine2),
    subdistrict: nullable(values.subdistrict),
    district: nullable(values.district),
    province: nullable(values.province),
    postalCode,
    phone: nullable(values.phone),
  }
}

export function localityValue(values: Pick<ReceiptSettingsFormValues, 'subdistrict' | 'district' | 'province' | 'postalCode'>) {
  if (!values.subdistrict || !values.district || !values.province || !values.postalCode) return null
  return {
    tambon: values.subdistrict, tambonEn: '',
    amphure: values.district, amphureEn: '',
    province: values.province, provinceEn: '',
    zipCode: values.postalCode, postalCode: values.postalCode,
    subdistrict: values.subdistrict, subdistrictEn: '',
    district: values.district, districtEn: '',
  }
}
