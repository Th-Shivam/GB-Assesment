import { z } from 'zod'

// Mirrors backend/app/schemas/analytics.py. All required values are validated at
// the network boundary; types are inferred, not asserted from untrusted JSON.
const timestamp = z.iso.datetime({ offset: true })
const count = z.number().int().nonnegative()
const nullableMW = z.number().nullable()
export const marketSchema = z.enum(['n2ex', 'epex', 'custom'])
export const comparisonModeSchema = z.enum(['unverified', 'hourly_average_assumption'])

export const healthSchema = z.object({
  status: z.literal('ok'),
  scope: z.literal('process_liveness_only'),
})

export const errorSchema = z.object({
  code: z.string(),
  message: z.string(),
  retry_after_seconds: count.nullable(),
})

export const metadataSchema = z.object({
  methodology_version: z.string(),
  source: z.literal('Elexon BMRS'),
  coverage_scope: z.string(),
  delivery_start: timestamp,
  delivery_end_exclusive: timestamp,
  resolution_minutes: z.literal(60),
  units: z.literal('MW'),
  market: marketSchema,
  market_gate_time: z.string().nullable(),
  internal_decision_time: z.string().nullable(),
  effective_decision_time: z.string(),
  decision_timezone: z.literal('Europe/London'),
  cutoff_inclusive: z.boolean(),
  comparison_mode: comparisonModeSchema,
  forecast_semantics_verified: z.literal(false),
  publication_search_start: timestamp,
  publication_search_end: timestamp,
  retrieval_windows_complete: z.literal(true),
  warnings: z.array(z.string()),
  fetches: z.array(z.object({
    dataset: z.enum(['FUELHH', 'WINDFOR']),
    native_resolution_minutes: z.union([z.literal(30), z.literal(60)]),
    http_status: z.literal(200),
    request_url: z.string(),
    retrieved_at: timestamp,
    sha256: z.string(),
    received_rows: count,
    accepted_rows: count,
    cache_hit: z.boolean(),
  })),
})

export const qualitySchema = z.object({
  expected_half_hours: count,
  usable_actual_half_hours: count,
  expected_hours: count,
  usable_actual_hours: count,
  usable_forecast_hours: count,
  available_pairs: count,
  evaluated_pairs: count,
  available_pair_coverage_percent: z.number().min(0).max(100),
  actual_duplicate_rows: count,
  forecast_duplicate_rows: count,
  actual_conflicting_keys: count,
  forecast_conflicting_keys: count,
  excluded_by_reason: z.record(z.string(), count),
})

export const metricsSchema = z.object({
  status: z.enum(['available_under_assumption', 'semantics_unverified', 'no_valid_pairs']),
  paired_count: count,
  mae_mw: nullableMW,
  rmse_mw: nullableMW,
  signed_bias_mw: nullableMW,
  wape_percent: nullableMW,
  wape_denominator_absolute_actual_mw_sum: z.number(),
  mape_positive_actual_percent: nullableMW,
  mape_positive_actual_count: count,
  percentage_excluded_nonpositive_actual_count: count,
  percentage_unavailable_reason: z.string().nullable(),
  error_sign: z.literal('forecast_minus_actual'),
})

export const comparisonPointSchema = z.object({
  start_time: timestamp,
  end_time: timestamp,
  decision_cutoff: timestamp,
  actual_mw: nullableMW,
  actual_half_hour_mw: z.array(z.number().int().nullable()).length(2),
  actual_publish_times: z.array(timestamp.nullable()).length(2),
  forecast_mw: z.number().int().nullable(),
  forecast_publish_time: timestamp.nullable(),
  forecast_age_at_decision_hours: nullableMW,
  forecast_horizon_hours: nullableMW,
  pair_available: z.boolean(),
  evaluated: z.boolean(),
  issues: z.array(z.string()),
  signed_error_mw: nullableMW,
  absolute_error_mw: nullableMW,
  signed_percentage_error: nullableMW,
  absolute_percentage_error: nullableMW,
})

export const summarySchema = z.object({
  metadata: metadataSchema,
  quality: qualitySchema,
  metrics: metricsSchema,
})
export const seriesSchema = summarySchema.extend({ data: z.array(comparisonPointSchema) })
export const errorAnalysisSchema = summarySchema.extend({
  by_day: z.array(z.object({
    delivery_date: z.iso.date(),
    expected_hours: count,
    available_pairs: count,
    metrics: metricsSchema,
  })),
  largest_absolute_errors: z.array(comparisonPointSchema),
})
export const historySchema = z.object({
  metadata: metadataSchema,
  target: timestamp,
  decision_cutoff: timestamp,
  status: z.enum(['available', 'empty']),
  data: z.array(z.object({
    start_time: timestamp,
    publish_time: timestamp,
    generation_mw: z.number().int().nullable(),
    eligible: z.boolean(),
    selected: z.boolean(),
    conflicting: z.boolean(),
    duplicate_rows: count,
    issues: z.array(z.string()),
  })),
})

export type Metadata = z.infer<typeof metadataSchema>
export type Quality = z.infer<typeof qualitySchema>
export type Metrics = z.infer<typeof metricsSchema>
export type ComparisonPoint = z.infer<typeof comparisonPointSchema>
export type SummaryResponse = z.infer<typeof summarySchema>
export type SeriesResponse = z.infer<typeof seriesSchema>
export type ErrorAnalysisResponse = z.infer<typeof errorAnalysisSchema>
export type HistoryResponse = z.infer<typeof historySchema>
export type Market = z.infer<typeof marketSchema>
export type ComparisonMode = z.infer<typeof comparisonModeSchema>

export interface Policy {
  market?: Market
  decision_time?: string
  cutoff_inclusive?: boolean
  comparison_mode: ComparisonMode
}

export interface DashboardData {
  summary: SummaryResponse
  series: SeriesResponse
  errors: ErrorAnalysisResponse
}
