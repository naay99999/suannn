'use client'

import * as React from 'react'
import { listAmphures, listProvinces, listTambons } from 'thaizip'
import type {
  AmphureSummary,
  ProvinceSummary,
  ResolvedThaiAddress,
  TambonSummary,
  TrigramIndex,
} from 'thaizip'

export type AddressLocale = 'th' | 'en'

// Constructing an Intl.Collator is not free, so build one per locale at module
// load instead of inside each memo (the core library caches its own collator
// for the same reason — see thaizip's enumerate.ts).
const COLLATORS = { th: new Intl.Collator('th'), en: new Intl.Collator('en') } as const

export type ThaiAddressCascadeSelectTexts = {
  provinceLabel: string
  districtLabel: string
  subdistrictLabel: string
  zipLabel: string
  provincePlaceholder: string
  districtPlaceholder: string
  subdistrictPlaceholder: string
  loadingText: string
  errorText: string
  retryLabel: string
}

export const DEFAULT_CASCADE_TEXTS: Record<AddressLocale, ThaiAddressCascadeSelectTexts> = {
  th: {
    provinceLabel: 'จังหวัด',
    districtLabel: 'อำเภอ/เขต',
    subdistrictLabel: 'ตำบล/แขวง',
    zipLabel: 'รหัสไปรษณีย์',
    provincePlaceholder: 'เลือกจังหวัด',
    districtPlaceholder: 'เลือกอำเภอ/เขต',
    subdistrictPlaceholder: 'เลือกตำบล/แขวง',
    loadingText: 'กำลังโหลดข้อมูล...',
    errorText: 'โหลดข้อมูลที่อยู่ไม่สำเร็จ',
    retryLabel: 'ลองใหม่',
  },
  en: {
    provinceLabel: 'Province',
    districtLabel: 'District',
    subdistrictLabel: 'Sub-district',
    zipLabel: 'Postal code',
    provincePlaceholder: 'Select province',
    districtPlaceholder: 'Select district',
    subdistrictPlaceholder: 'Select sub-district',
    loadingText: 'Loading address data...',
    errorText: 'Failed to load address data',
    retryLabel: 'Retry',
  },
}

export type CascadeOption = { id: number; nameTh: string; nameEn: string }

export function optionName(option: CascadeOption, locale: AddressLocale): string {
  return locale === 'en' ? option.nameEn : option.nameTh
}

function buildResolved(
  province: ProvinceSummary,
  amphure: AmphureSummary,
  tambon: TambonSummary,
): ResolvedThaiAddress {
  return {
    tambon: tambon.nameTh,
    tambonEn: tambon.nameEn,
    amphure: amphure.nameTh,
    amphureEn: amphure.nameEn,
    province: province.nameTh,
    provinceEn: province.nameEn,
    zipCode: tambon.zipCode,
    subdistrict: tambon.nameTh,
    subdistrictEn: tambon.nameEn,
    district: amphure.nameTh,
    districtEn: amphure.nameEn,
    postalCode: tambon.zipCode,
  }
}

type SelectionIds = { provinceId: number | null; amphureId: number | null; tambonId: number | null }

const EMPTY_SELECTION: SelectionIds = { provinceId: null, amphureId: null, tambonId: null }

/**
 * Maps a `ResolvedThaiAddress` (names only — the type carries no ids) back onto
 * enumeration-API ids by exact Thai-name match down the chain. Returns the empty
 * selection when any link fails to match, so a stale/foreign address degrades to
 * an unselected cascade instead of a half-selected one.
 */
function selectionFromAddress(index: TrigramIndex, address: ResolvedThaiAddress | null): SelectionIds {
  if (!address) return EMPTY_SELECTION
  const province = listProvinces(index).find((entry) => entry.nameTh === address.province)
  if (!province) return EMPTY_SELECTION
  const amphure = listAmphures(index, province.id).find((entry) => entry.nameTh === address.district)
  if (!amphure) return EMPTY_SELECTION
  const tambon = listTambons(index, amphure.id).find((entry) => entry.nameTh === address.subdistrict)
  if (!tambon) return EMPTY_SELECTION
  return { provinceId: province.id, amphureId: amphure.id, tambonId: tambon.id }
}

export type UseThaiAddressCascadeOptions = {
  index: TrigramIndex
  /** Controlled resolved address. Pass `null` to clear a controlled cascade. */
  value?: ResolvedThaiAddress | null
  /** Uncontrolled seed value; pre-selects the full province > district > subdistrict chain. */
  defaultValue?: ResolvedThaiAddress | null
  onValueChange?: (address: ResolvedThaiAddress | null) => void
  /** Drives option sort order. Defaults to `'th'`. */
  locale?: AddressLocale
}

export type ThaiAddressCascadeState = {
  provinces: ProvinceSummary[]
  amphures: AmphureSummary[]
  tambons: TambonSummary[]
  provinceId: number | null
  amphureId: number | null
  tambonId: number | null
  selectedProvince: ProvinceSummary | null
  selectedAmphure: AmphureSummary | null
  selectedTambon: TambonSummary | null
  resolvedAddress: ResolvedThaiAddress | null
  /** Zip code of the selected sub-district, or `''` when the chain is incomplete. */
  zipCode: string
  setProvince: (next: number | null) => void
  setAmphure: (next: number | null) => void
  setTambon: (next: number | null) => void
}

/**
 * Engine-free province > district > sub-district cascade. Owns the selection
 * state, the controlled/uncontrolled sync, the locale-sorted option lists, and
 * the reset-downstream rules — so a Base UI, Radix, React Aria or plain-Tailwind
 * cascade component is only a view over this.
 */
export function useThaiAddressCascade({
  index,
  value,
  defaultValue,
  onValueChange,
  locale = 'th',
}: UseThaiAddressCascadeOptions): ThaiAddressCascadeState {
  const isControlled = value !== undefined

  const [selection, setSelection] = React.useState<SelectionIds>(() =>
    selectionFromAddress(index, isControlled ? (value ?? null) : (defaultValue ?? null)),
  )
  const { provinceId, amphureId, tambonId } = selection

  // Controlled mode: re-map ids whenever the caller swaps `value` (including -> null).
  // Runs only on `value` identity changes, so in-progress partial picks (which never
  // emit a value) are not wiped between renders.
  React.useEffect(() => {
    if (!isControlled) return
    setSelection((current) => {
      if (value) return selectionFromAddress(index, value)
      // value === null: an external clear wipes a *full* local selection; a null
      // echoed back right after our own parent-change invalidation must not
      // reset the in-progress partial pick.
      return current.tambonId === null ? current : EMPTY_SELECTION
    })
  }, [isControlled, index, value])

  const provinces = React.useMemo(() => {
    const collator = COLLATORS[locale === 'en' ? 'en' : 'th']
    return [...listProvinces(index)].sort((a, b) => collator.compare(optionName(a, locale), optionName(b, locale)))
  }, [index, locale])
  const amphures = React.useMemo(() => {
    if (provinceId === null) return []
    const collator = COLLATORS[locale === 'en' ? 'en' : 'th']
    return [...listAmphures(index, provinceId)].sort((a, b) => collator.compare(optionName(a, locale), optionName(b, locale)))
  }, [index, provinceId, locale])
  const tambons = React.useMemo(() => {
    if (amphureId === null) return []
    const collator = COLLATORS[locale === 'en' ? 'en' : 'th']
    return [...listTambons(index, amphureId)].sort((a, b) => collator.compare(optionName(a, locale), optionName(b, locale)))
  }, [index, amphureId, locale])

  const selectedProvince = provinceId === null ? null : (provinces.find((entry) => entry.id === provinceId) ?? null)
  const selectedAmphure = amphureId === null ? null : (amphures.find((entry) => entry.id === amphureId) ?? null)
  const selectedTambon = tambonId === null ? null : (tambons.find((entry) => entry.id === tambonId) ?? null)

  const resolvedAddress: ResolvedThaiAddress | null = isControlled
    ? (value ?? null)
    : selectedProvince && selectedAmphure && selectedTambon
      ? buildResolved(selectedProvince, selectedAmphure, selectedTambon)
      : null

  const hadFullSelection = tambonId !== null

  function setProvince(nextId: number | null) {
    setSelection({ provinceId: nextId, amphureId: null, tambonId: null })
    if (hadFullSelection) onValueChange?.(null)
  }

  function setAmphure(nextId: number | null) {
    setSelection((current) => ({ provinceId: current.provinceId, amphureId: nextId, tambonId: null }))
    if (hadFullSelection) onValueChange?.(null)
  }

  function setTambon(nextId: number | null) {
    setSelection((current) => ({ ...current, tambonId: nextId }))
    if (nextId === null) {
      if (hadFullSelection) onValueChange?.(null)
      return
    }
    const tambon = tambons.find((entry) => entry.id === nextId)
    if (tambon && selectedProvince && selectedAmphure) {
      onValueChange?.(buildResolved(selectedProvince, selectedAmphure, tambon))
    }
  }

  return {
    provinces,
    amphures,
    tambons,
    provinceId,
    amphureId,
    tambonId,
    selectedProvince,
    selectedAmphure,
    selectedTambon,
    resolvedAddress,
    zipCode: selectedTambon?.zipCode ?? '',
    setProvince,
    setAmphure,
    setTambon,
  }
}
