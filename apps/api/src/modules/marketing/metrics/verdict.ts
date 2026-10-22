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
  // Exact integer form of ROAS vs break-even x 1.1 / x 0.9; margin has at most one decimal.
  const margin10 = BigInt(Math.round(input.marginPercent * 10))
  const scaledRevenue = BigInt(input.revenueSatang) * margin10
  const spend = BigInt(input.spendSatang)
  if (scaledRevenue >= spend * 1100n) return 'profit'
  if (scaledRevenue < spend * 900n) return 'loss'
  return 'breakeven'
}
