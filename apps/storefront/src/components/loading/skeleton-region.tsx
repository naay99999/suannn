import type { ReactNode } from 'react'

/** Accessible wrapper for skeleton placeholders: one polite status announcement, decorative shapes. */
export function SkeletonRegion({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div role="status" aria-busy="true" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  )
}
