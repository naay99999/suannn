import type { ThaiAddressCascadeSelectProps } from '@workspace/ui/components/thai-address-cascade-select'

type CheckoutLocality = {
  subdistrict: string
  district: string
  province: string
  postalCode: string
}

export function checkoutAddressFields(address: CheckoutLocality | null) {
  return {
    subdistrict: address?.subdistrict ?? '',
    district: address?.district ?? '',
    province: address?.province ?? '',
    postalCode: address?.postalCode ?? '',
  }
}

export function checkoutAddressDefaultValue(address: Partial<CheckoutLocality> | null | undefined): NonNullable<ThaiAddressCascadeSelectProps['value']> | null {
  if (!address?.subdistrict || !address.district || !address.province || !address.postalCode) return null

  return {
    tambon: address.subdistrict,
    tambonEn: '',
    amphure: address.district,
    amphureEn: '',
    province: address.province,
    provinceEn: '',
    zipCode: address.postalCode,
    subdistrict: address.subdistrict,
    subdistrictEn: '',
    district: address.district,
    districtEn: '',
    postalCode: address.postalCode,
  }
}
