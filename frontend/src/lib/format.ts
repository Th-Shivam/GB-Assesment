export const UK_TIMEZONE = 'Europe/London'
export const MISSING = '—'

function date(value: string | null | undefined): Date | null {
  if (!value) return null
  // Calendar-only inputs are explicitly UTC midnight, not the browser timezone.
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value)
  return Number.isFinite(parsed.getTime()) ? parsed : null
}

function dateFormat(value: string | null | undefined, options: Intl.DateTimeFormatOptions): string {
  const parsed = date(value)
  return parsed ? new Intl.DateTimeFormat('en-GB', { timeZone: UK_TIMEZONE, ...options }).format(parsed) : MISSING
}

export const formatTimestamp = (value: string | null | undefined) => dateFormat(value, {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short',
})
export const formatDay = (value: string) => dateFormat(value, { day: '2-digit', month: 'short' })
export const formatHour = (value: string) => dateFormat(value, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

export function ukDay(value: string): string {
  const parsed = date(value)
  if (!parsed) return ''
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: UK_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(parsed)
  return ['year', 'month', 'day'].map((type) => parts.find((part) => part.type === type)?.value).join('-')
}

export function formatNumber(value: number | null | undefined, decimals = 1, signed = false): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return MISSING
  // Do not render a negative zero after display-only rounding.
  const rounded = Number(value.toFixed(decimals)) || 0
  return new Intl.NumberFormat('en-GB', {
    minimumFractionDigits: decimals, maximumFractionDigits: decimals,
    signDisplay: signed ? 'exceptZero' : 'auto',
  }).format(rounded)
}

export const formatMW = (value: number | null | undefined, signed = false) =>
  value === null || value === undefined || !Number.isFinite(value) ? MISSING : `${formatNumber(value, 1, signed)} MW`

export function availableMean(values: (number | null)[]): { mean: number | null; count: number } {
  const available = values.filter((value): value is number => value !== null && Number.isFinite(value))
  return {
    mean: available.length ? available.reduce((sum, value) => sum + value, 0) / available.length : null,
    count: available.length,
  }
}

export function issueLabel(issue: string): string {
  const labels: Record<string, string> = {
    forecast_semantics_unverified: 'Averaging semantics unverified',
    missing_actual: 'Missing actual half-hour', null_actual: 'Null actual',
    missing_forecast: 'No eligible forecast in searched history', null_forecast: 'Null selected forecast',
    conflicting_actual: 'Conflicting actual', conflicting_forecast: 'Conflicting forecast',
    negative_actual: 'Negative actual · review', negative_forecast: 'Negative forecast · review',
  }
  return labels[issue] || issue.replaceAll('_', ' ')
}
