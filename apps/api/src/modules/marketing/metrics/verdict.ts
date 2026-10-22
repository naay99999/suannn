const profitFactor = 1.1
const lossFactor = 0.9

export type Verdict = 'profit' | 'breakeven' | 'loss' | 'no_sales'

// ROAS at which ad spend exactly equals gross profit on the revenue it drove.
export function breakEvenRoas(marginPercent: number): number {
  return 100 / marginPercent
}

export function roas(revenueSatang: number, spendSatang: number | null): number | null {
  if (spendSatang === null || spendSatang <= 0) return null
  return revenueSatang / spendSatang
}

export function costPerOrderSatang(spendSatang: number | null, orders: number): number | null {
  if (spendSatang === null || spendSatang <= 0 || orders <= 0) return null
  return Math.round(spendSatang / orders)
}

export function verdict(input: {
  spendSatang: number | null
  orders: number
  revenueSatang: number
  marginPercent: number
}): Verdict | null {
  if (input.spendSatang === null || input.spendSatang <= 0) return null
  if (input.orders === 0) return 'no_sales'
  const ratio = input.revenueSatang / input.spendSatang
  const breakEven = breakEvenRoas(input.marginPercent)
  if (ratio >= breakEven * profitFactor) return 'profit'
  if (ratio < breakEven * lossFactor) return 'loss'
  return 'breakeven'
}
