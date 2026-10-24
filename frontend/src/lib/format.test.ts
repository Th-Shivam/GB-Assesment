import { describe, expect, it } from 'vitest'
import { availableMean, formatDay, formatHour, formatMW, formatNumber, formatTimestamp, issueLabel, ukDay } from './format'

describe('generation formatting', () => {
  it('distinguishes missing values from genuine zeros', () => {
    for (const missing of [null, undefined, NaN, Infinity]) expect(formatNumber(missing)).toBe('—')
    expect(formatNumber(0)).toBe('0.0')
    expect(formatMW(0)).toBe('0.0 MW')
    expect(formatMW(null)).toBe('—')
  })
  it('uses British grouping, display-only rounding and a defined bias sign', () => {
    expect(formatMW(1234.56, true)).toBe('+1,234.6 MW')
    expect(formatNumber(-12.34, 1, true)).toBe('-12.3')
    expect(formatNumber(-0.01, 1, true)).toBe('0.0')
  })
  it('computes means only over available observations, retaining zero/negative values', () => {
    expect(availableMean([null, 0, 100, -40])).toEqual({ mean: 20, count: 3 })
    expect(availableMean([null, null])).toEqual({ mean: null, count: 0 })
    expect(availableMean([])).toEqual({ mean: null, count: 0 })
  })
})

describe('explicit Europe/London date formatting', () => {
  it('preserves January/December boundaries and GMT', () => {
    expect(formatTimestamp('2025-12-31T09:30:00Z')).toBe('31 Dec 2025, 09:30 GMT')
    expect(formatTimestamp('2026-01-31T23:30:00Z')).toBe('31 Jan 2026, 23:30 GMT')
    expect(ukDay('2026-02-01T00:30:00+01:00')).toBe('2026-01-31')
    expect(formatDay('2026-01-01')).toBe('01 Jan')
    expect(formatHour('2026-01-01T00:00:00Z')).toBe('00:00')
  })
  it('does not generalise January GMT to British summer time', () => {
    expect(formatTimestamp('2026-07-01T00:00:00Z')).toBe('01 Jul 2026, 01:00 BST')
    expect(ukDay('2026-06-30T23:30:00Z')).toBe('2026-07-01')
  })
  it('renders invalid/missing dates honestly', () => {
    expect(formatTimestamp(null)).toBe('—')
    expect(formatTimestamp('not-a-date')).toBe('—')
    expect(ukDay('invalid')).toBe('')
  })
  it('explains source issues without disguising conflicts as zeros', () => {
    expect(issueLabel('conflicting_forecast')).toBe('Conflicting forecast')
    expect(issueLabel('future_source_flag')).toBe('future source flag')
  })
})
