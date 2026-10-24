// SYNTHETIC TEST FIXTURES ONLY. Never imported by the application or live checks.
import type { DashboardData, HistoryResponse, Metadata, Metrics, ComparisonPoint } from '../api/schemas'

export function makeMetadata(conditional = false): Metadata {
  return {
    methodology_version: '2.0', source: 'Elexon BMRS', coverage_scope: 'GB operationally visible wind; not all UK wind generation',
    delivery_start: '2026-01-01T00:00:00Z', delivery_end_exclusive: '2026-02-01T00:00:00Z',
    resolution_minutes: 60, units: 'MW', market: 'n2ex', market_gate_time: '09:50',
    internal_decision_time: null, effective_decision_time: '09:50', decision_timezone: 'Europe/London',
    cutoff_inclusive: true, comparison_mode: conditional ? 'hourly_average_assumption' : 'unverified',
    forecast_semantics_verified: false, publication_search_start: '2025-12-29T00:00:00Z',
    publication_search_end: '2026-01-31T00:00:00Z', retrieval_windows_complete: true,
    warnings: ['Synthetic test warning: publication time is not trader receipt.'],
    fetches: [{ dataset: 'FUELHH', native_resolution_minutes: 30, http_status: 200,
      request_url: 'https://example.invalid/synthetic-fuelhh', retrieved_at: '2026-10-24T12:00:00Z',
      sha256: 'synthetic-not-a-real-checksum', received_rows: 48, accepted_rows: 48, cache_hit: false }],
  }
}

export function makeMetrics(conditional = false): Metrics {
  return {
    status: conditional ? 'available_under_assumption' : 'semantics_unverified', paired_count: conditional ? 24 : 0,
    mae_mw: conditional ? 10 : null, rmse_mw: conditional ? 10 : null, signed_bias_mw: conditional ? 10 : null,
    wape_percent: conditional ? 10 : null, wape_denominator_absolute_actual_mw_sum: conditional ? 2400 : 0,
    mape_positive_actual_percent: conditional ? 10 : null, mape_positive_actual_count: conditional ? 24 : 0,
    percentage_excluded_nonpositive_actual_count: 0, percentage_unavailable_reason: null, error_sign: 'forecast_minus_actual',
  }
}

export function makePoint(index = 0, conditional = false): ComparisonPoint {
  const start = Date.UTC(2026, 0, 1, index)
  return {
    start_time: new Date(start).toISOString(), end_time: new Date(start + 3_600_000).toISOString(),
    decision_cutoff: '2025-12-31T09:50:00Z', actual_mw: 100, actual_half_hour_mw: [80, 120],
    actual_publish_times: [new Date(start + 1_800_000).toISOString(), new Date(start + 3_600_000).toISOString()],
    forecast_mw: 110, forecast_publish_time: '2025-12-31T09:30:00Z',
    forecast_age_at_decision_hours: 1 / 3, forecast_horizon_hours: 14.5 + index,
    pair_available: true, evaluated: conditional, issues: conditional ? [] : ['forecast_semantics_unverified'],
    signed_error_mw: conditional ? 10 : null, absolute_error_mw: conditional ? 10 : null,
    signed_percentage_error: conditional ? 10 : null, absolute_percentage_error: conditional ? 10 : null,
  }
}

export function makeDashboard(conditional = false): DashboardData {
  const summary = {
    metadata: makeMetadata(conditional), metrics: makeMetrics(conditional),
    quality: { expected_half_hours: 1488, usable_actual_half_hours: 48, expected_hours: 744,
      usable_actual_hours: 24, usable_forecast_hours: 24, available_pairs: 24, evaluated_pairs: conditional ? 24 : 0,
      available_pair_coverage_percent: 100 * 24 / 744, actual_duplicate_rows: 0, forecast_duplicate_rows: 0,
      actual_conflicting_keys: 0, forecast_conflicting_keys: 0, excluded_by_reason: { missing_actual: 720, missing_forecast: 720 } },
  }
  return {
    summary,
    series: { ...structuredClone(summary), data: Array.from({ length: 24 }, (_, i) => makePoint(i, conditional)) },
    errors: { ...structuredClone(summary), by_day: [{ delivery_date: '2026-01-01', expected_hours: 24, available_pairs: 24, metrics: makeMetrics(conditional) }], largest_absolute_errors: conditional ? [makePoint(0, true)] : [] },
  }
}

export function makeHistory(target = '2026-01-01T00:00:00Z', conditional = false): HistoryResponse {
  return {
    metadata: makeMetadata(conditional), target, decision_cutoff: '2025-12-31T09:50:00Z', status: 'available',
    data: [{ start_time: target, publish_time: '2025-12-31T09:30:00Z', generation_mw: 110,
      eligible: true, selected: true, conflicting: false, duplicate_rows: 0, issues: [] },
    { start_time: target, publish_time: '2025-12-31T11:30:00Z', generation_mw: 120,
      eligible: false, selected: false, conflicting: false, duplicate_rows: 0, issues: [] }],
  }
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
