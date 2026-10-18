import { cn } from '@workspace/ui/lib/utils'

// Bordered surfaces in the account area look like Card; their padding matches Card's account spacing (see storefront.css).
export const accountSurface = 'rounded-surface border bg-card'
export const accountSurfacePadding = 'p-5 md:p-6'
// Text links stay underlined so they never rely on colour alone.
export const textLink = 'rounded-sm font-medium text-primary-ink underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring'
// Links that stand on their own get the same 44px hit area as storefront buttons.
export const standaloneTextLink = cn(textLink, 'inline-flex min-h-11 items-center gap-1')

// Settings pages (profile, security) group their rows in one bordered list.
export const settingListClassName = cn('divide-y overflow-hidden', accountSurface)
