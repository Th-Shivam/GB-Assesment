import type { Metadata, Metrics, Quality } from '../api/schemas'

export function metricsAvailable(metadata: Metadata, metrics: Metrics): boolean {
  return metadata.comparison_mode === 'hourly_average_assumption' &&
    metrics.status === 'available_under_assumption' && metrics.paired_count > 0
}

export function metricStatus(metadata: Metadata, metrics: Metrics): string {
  if (metadata.comparison_mode === 'unverified' || metrics.status === 'semantics_unverified') {
    return 'Accuracy metrics unavailable — forecast averaging semantics require verification.'
  }
  if (metrics.status === 'no_valid_pairs' || metrics.paired_count === 0) {
    return 'No valid pairs — conditional accuracy metrics are unavailable.'
  }
  return 'Conditional accuracy metrics — dependent on the unverified hourly-average assumption.'
}

export function coverageStatus(quality: Quality): 'empty' | 'partial' | 'complete' {
  if (quality.usable_actual_half_hours === 0 && quality.usable_forecast_hours === 0) return 'empty'
  if (quality.expected_hours === 0 || quality.available_pairs < quality.expected_hours ||
    quality.usable_actual_half_hours < quality.expected_half_hours) return 'partial'
  return 'complete'
}

export function retrievalRange(metadata: Metadata): { first: string | null; last: string | null; cached: number } {
  const times = metadata.fetches.map((fetch) => fetch.retrieved_at).sort((a, b) => Date.parse(a) - Date.parse(b))
  return { first: times[0] ?? null, last: times.at(-1) ?? null, cached: metadata.fetches.filter((fetch) => fetch.cache_hit).length }
}
