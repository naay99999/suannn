'use client'

import * as React from 'react'
import type { ResolvedThaiAddress, TrigramIndex } from 'thaizip'
import { cn } from '@workspace/ui/lib/utils'
import { useThaiAddressIndex } from '@workspace/ui/hooks/use-thai-address-index'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/components/select'
import { Label } from '@workspace/ui/components/label'
import { Button } from '@workspace/ui/components/button'
import { Input } from '@workspace/ui/components/input'
import {
  DEFAULT_CASCADE_TEXTS,
  optionName,
  useThaiAddressCascade,
  type AddressLocale,
  type CascadeOption,
  type ThaiAddressCascadeSelectTexts,
} from '@workspace/ui/hooks/use-thai-address-cascade'

export type { ThaiAddressCascadeSelectTexts }

// This file's filename and its `ThaiAddressCascadeSelect`/`ThaiAddressCascadeSelectTexts`
// export names are relied on by sibling templates (thai-address-form.tsx,
// thai-address-form-field.tsx) via plain relative imports that no tooling validates at
// scaffold time — renaming either requires updating those files too.
export type ThaiAddressCascadeSelectProps = {
  /** Controlled resolved address. Pass `null` to clear a controlled cascade. */
  value?: ResolvedThaiAddress | null
  /** Uncontrolled seed value; pre-selects the full province > district > subdistrict chain. */
  defaultValue?: ResolvedThaiAddress | null
  onValueChange?: (address: ResolvedThaiAddress | null) => void
  /** When set, renders 4 hidden inputs: `${name}-subdistrict|-district|-province|-zipcode`. */
  name?: string
  /** Drives option labels and the default texts. Defaults to `'th'`. */
  locale?: AddressLocale
  texts?: Partial<ThaiAddressCascadeSelectTexts>
  disabled?: boolean
  required?: boolean
  /** Blur handler for the province trigger (the cascade's primary control). */
  onBlur?: React.FocusEventHandler<HTMLButtonElement>
  onError?: (error: Error) => void
  /** Marks all three select triggers invalid (e.g. after failed form validation). */
  'aria-invalid'?: React.AriaAttributes['aria-invalid']
  /** Applied to the root grid wrapper element. */
  className?: string
  labelClassName?: string
  triggerClassName?: string
  popupClassName?: string
  itemClassName?: string
  /** Forwarded to the province trigger button (the cascade's primary control). */
  ref?: React.Ref<HTMLButtonElement>
}

export function ThaiAddressCascadeSelect({
  locale = 'th',
  texts,
  disabled = false,
  className,
  labelClassName,
  triggerClassName,
  onError,
  ref,
  ...rest
}: ThaiAddressCascadeSelectProps) {
  const resolvedTexts = React.useMemo<ThaiAddressCascadeSelectTexts>(
    () => ({ ...DEFAULT_CASCADE_TEXTS[locale], ...texts }),
    [locale, texts],
  )

  const { index, error, retry } = useThaiAddressIndex()

  React.useEffect(() => {
    if (error) onError?.(error)
  }, [error, onError])

  if (error) {
    return (
      <div
        role="alert"
        className={cn(
          'flex flex-col items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive',
          className,
        )}
      >
        <p>{resolvedTexts.errorText}</p>
        <Button type="button" variant="outline" onClick={retry}>
          {resolvedTexts.retryLabel}
        </Button>
      </div>
    )
  }

  // Same rationale as thai-address-autocomplete.tsx: mount the index-consuming
  // subtree only once `index` is final and stable.
  if (!index) {
    return (
      <div aria-busy="true" className={cn('grid w-full grid-cols-1 gap-4 sm:grid-cols-2', className)}>
        {[resolvedTexts.provinceLabel, resolvedTexts.districtLabel, resolvedTexts.subdistrictLabel, resolvedTexts.zipLabel].map(
          (label) => (
            <div key={label} className="flex flex-col gap-1.5">
              <Label className={labelClassName}>{label}</Label>
              <Button type="button" variant="outline" disabled className={cn('w-full justify-start font-normal', triggerClassName)}>
                {resolvedTexts.loadingText}
              </Button>
            </div>
          ),
        )}
      </div>
    )
  }

  return (
    <ThaiAddressCascadeSelectReady
      {...rest}
      index={index}
      locale={locale}
      texts={resolvedTexts}
      disabled={disabled}
      className={className}
      labelClassName={labelClassName}
      triggerClassName={triggerClassName}
      ref={ref}
    />
  )
}

type ReadyProps = Omit<ThaiAddressCascadeSelectProps, 'texts' | 'onError'> & {
  index: TrigramIndex
  locale: AddressLocale
  texts: ThaiAddressCascadeSelectTexts
}

function ThaiAddressCascadeSelectReady({
  index,
  value,
  defaultValue,
  onValueChange,
  name,
  locale,
  texts,
  disabled = false,
  required = false,
  onBlur,
  'aria-invalid': ariaInvalid,
  className,
  labelClassName,
  triggerClassName,
  popupClassName,
  itemClassName,
  ref,
}: ReadyProps) {
  const id = React.useId()

  const {
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
    zipCode: zipValue,
    setProvince: handleProvinceChange,
    setAmphure: handleAmphureChange,
    setTambon: handleTambonChange,
  } = useThaiAddressCascade({ index, value, defaultValue, onValueChange, locale })

  return (
    <div className={cn('grid w-full grid-cols-1 gap-4 sm:grid-cols-2', className)}>
      <CascadeField
        labelId={`${id}-province-label`}
        label={texts.provinceLabel}
        placeholder={texts.provincePlaceholder}
        options={provinces}
        value={provinceId}
        selected={selectedProvince}
        onChange={handleProvinceChange}
        disabled={disabled}
        required={required}
        locale={locale}
        triggerRef={ref}
        onBlur={onBlur}
        ariaInvalid={ariaInvalid}
        labelClassName={labelClassName}
        triggerClassName={triggerClassName}
        popupClassName={popupClassName}
        itemClassName={itemClassName}
      />
      <CascadeField
        labelId={`${id}-district-label`}
        label={texts.districtLabel}
        placeholder={texts.districtPlaceholder}
        options={amphures}
        value={amphureId}
        selected={selectedAmphure}
        onChange={handleAmphureChange}
        disabled={disabled || provinceId === null}
        required={required}
        locale={locale}
        ariaInvalid={ariaInvalid}
        labelClassName={labelClassName}
        triggerClassName={triggerClassName}
        popupClassName={popupClassName}
        itemClassName={itemClassName}
      />
      <CascadeField
        labelId={`${id}-subdistrict-label`}
        label={texts.subdistrictLabel}
        placeholder={texts.subdistrictPlaceholder}
        options={tambons}
        value={tambonId}
        selected={selectedTambon}
        onChange={handleTambonChange}
        disabled={disabled || amphureId === null}
        required={required}
        locale={locale}
        ariaInvalid={ariaInvalid}
        labelClassName={labelClassName}
        triggerClassName={triggerClassName}
        popupClassName={popupClassName}
        itemClassName={itemClassName}
      />

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-zip`} className={labelClassName}>
          {texts.zipLabel}
        </Label>
        <Input
          id={`${id}-zip`}
          readOnly
          tabIndex={-1}
          value={zipValue}
          className={cn('bg-muted text-muted-foreground', triggerClassName)}
        />
      </div>

      {name && (
        <>
          <input type="hidden" name={`${name}-subdistrict`} value={resolvedAddress?.subdistrict ?? ''} disabled={disabled} />
          <input type="hidden" name={`${name}-district`} value={resolvedAddress?.district ?? ''} disabled={disabled} />
          <input type="hidden" name={`${name}-province`} value={resolvedAddress?.province ?? ''} disabled={disabled} />
          <input type="hidden" name={`${name}-zipcode`} value={resolvedAddress?.zipCode ?? ''} disabled={disabled} />
        </>
      )}
    </div>
  )
}

type CascadeFieldProps = {
  labelId: string
  label: string
  placeholder: string
  options: CascadeOption[]
  value: number | null
  selected: CascadeOption | null
  onChange: (next: number | null) => void
  disabled: boolean
  required: boolean
  locale: AddressLocale
  triggerRef?: React.Ref<HTMLButtonElement>
  onBlur?: React.FocusEventHandler<HTMLButtonElement>
  ariaInvalid?: React.AriaAttributes['aria-invalid']
  labelClassName?: string
  triggerClassName?: string
  popupClassName?: string
  itemClassName?: string
}

function CascadeField({
  labelId,
  label,
  placeholder,
  options,
  value,
  selected,
  onChange,
  disabled,
  required,
  locale,
  triggerRef,
  onBlur,
  ariaInvalid,
  labelClassName,
  triggerClassName,
  popupClassName,
  itemClassName,
}: CascadeFieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label id={labelId} className={labelClassName}>
        {label}
      </Label>
      {/* Option ids cross into the Select as strings (SelectItem's `value` is
          string-typed) and back out as numbers in onChange — see the design
          spec's "Cascade-select engine" note. `null` (unset) is passed through
          as-is: Select's underlying Base UI Root supports a `null` controlled
          value the same way the vanilla Base UI template does directly. */}
      <Select
        value={value === null ? null : String(value)}
        onValueChange={(next) => onChange(next === null ? null : Number(next))}
        disabled={disabled}
        required={required}
      >
        <SelectTrigger
          ref={triggerRef}
          aria-labelledby={labelId}
          aria-invalid={ariaInvalid}
          onBlur={onBlur}
          className={cn('w-full', triggerClassName)}
        >
          <SelectValue placeholder={placeholder}>{selected ? optionName(selected, locale) : undefined}</SelectValue>
        </SelectTrigger>
        <SelectContent className={popupClassName}>
          {options.map((option) => (
            <SelectItem key={option.id} value={String(option.id)} className={itemClassName}>
              {optionName(option, locale)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
