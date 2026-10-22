import type { PostHogReadClient } from './client'

export interface ExperimentVariant {
  key: string
  exposures: number
  conversions: number
  conversionRate: number
}

export interface ExperimentSummary {
  id: number
  name: string
  status: 'draft' | 'running' | 'complete'
  startDate: string | null
  endDate: string | null
  flagKey: string
  url: string
  variants: ExperimentVariant[] | null
  winner: string | null
  readable: boolean
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? value as Record<string, unknown> : {}
const asString = (value: unknown) => (typeof value === 'string' && value ? value : null)

// Shapes follow PostHog's experiments API as documented: GET /api/projects/:id/experiments/ returns
// `{ results: [{ id, name, start_date, end_date, feature_flag_key }] }`, and the per-experiment results
// endpoint returns `{ significant, probability: { [variant]: number }, insight: [[step rows...] per variant] }`
// where each funnel step row has `count` and `breakdown_value: [variantKey]`. Written from the public docs and
// not verified against a live project (PostHog changes the results format between experiment engine versions),
// so every field is checked and anything unfamiliar yields `readable: false` instead of a guess.
function mapResults(raw: unknown): { variants: ExperimentVariant[], winner: string | null } | null {
  const results = asRecord(raw)
  const insight = results.insight
  const probability = asRecord(results.probability)
  if (typeof results.significant !== 'boolean' || !Array.isArray(insight) || insight.length === 0) return null
  const variants: ExperimentVariant[] = []
  for (const series of insight) {
    if (!Array.isArray(series) || series.length < 2) return null
    const first = asRecord(series[0])
    const last = asRecord(series[series.length - 1])
    const breakdown = first.breakdown_value
    const key = Array.isArray(breakdown) ? asString(breakdown[0]) : asString(breakdown)
    if (!key || typeof first.count !== 'number' || typeof last.count !== 'number') return null
    variants.push({
      key,
      exposures: first.count,
      conversions: last.count,
      conversionRate: first.count > 0 ? last.count / first.count : 0,
    })
  }
  let winner: string | null = null
  if (results.significant) {
    let best = -1
    for (const variant of variants) {
      const chance = probability[variant.key]
      if (typeof chance === 'number' && chance > best) {
        best = chance
        winner = variant.key
      }
    }
    if (best < 0) return null
  }
  return { variants, winner }
}

// Experiments without a start date are drafts and are omitted.
export async function getExperiments(client: PostHogReadClient): Promise<{ experiments: ExperimentSummary[] }> {
  const list = asRecord(await client.listExperiments()).results
  const rows = Array.isArray(list) ? list : []
  const experiments: ExperimentSummary[] = []
  for (const row of rows) {
    const item = asRecord(row)
    const startDate = asString(item.start_date)
    if (typeof item.id !== 'number' || !startDate) continue
    const endDate = asString(item.end_date)
    const mapped = await client.experimentResults(item.id).then(mapResults, () => null)
    experiments.push({
      id: item.id,
      name: asString(item.name) ?? `Experiment ${item.id}`,
      status: endDate ? 'complete' : 'running',
      startDate,
      endDate,
      flagKey: asString(item.feature_flag_key) ?? '',
      url: `${client.appUrl}/project/${client.projectId}/experiments/${item.id}`,
      variants: mapped?.variants ?? null,
      winner: mapped?.winner ?? null,
      readable: mapped !== null,
    })
  }
  return { experiments }
}
