import { describe, expect, it } from 'vitest'
import { makeDashboard, makeMetadata, makeMetrics } from '../test/fixtures'
import { coverageStatus, metricsAvailable, metricStatus, retrievalRange } from './analysis'
import { chartDomain, linePath } from './chart'

describe('methodology and coverage', () => {
  it('withholds scores without both response mode and available status', () => {
    expect(metricsAvailable(makeMetadata(), makeMetrics(true))).toBe(false)
    expect(metricsAvailable(makeMetadata(true), makeMetrics())).toBe(false)
    expect(metricStatus(makeMetadata(), makeMetrics())).toContain('forecast averaging semantics require verification')
  })
  it('always labels enabled metrics as conditional, never verified', () => {
    expect(metricsAvailable(makeMetadata(true), makeMetrics(true))).toBe(true)
    expect(metricStatus(makeMetadata(true), makeMetrics(true))).toMatch(/Conditional.*unverified hourly-average assumption/)
    expect(makeMetadata(true).forecast_semantics_verified).toBe(false)
  })
  it('handles an opt-in without valid pairs', () => {
    const metrics = { ...makeMetrics(), status: 'no_valid_pairs' as const }
    expect(metricsAvailable(makeMetadata(true), metrics)).toBe(false)
    expect(metricStatus(makeMetadata(true), metrics)).toContain('No valid pairs')
  })
  it('distinguishes empty, partial and complete observations independently of evaluation', () => {
    const quality = makeDashboard().summary.quality
    expect(coverageStatus(quality)).toBe('partial')
    expect(coverageStatus({ ...quality, usable_actual_half_hours: 0, usable_forecast_hours: 0 })).toBe('empty')
    expect(coverageStatus({ ...quality, available_pairs: 744, usable_actual_half_hours: 1488 })).toBe('complete')
  })
  it('uses source retrieval timestamps instead of the browser clock', () => {
    const metadata = makeMetadata()
    metadata.fetches.push({ ...metadata.fetches[0], retrieved_at: '2026-10-24T12:10:00Z', cache_hit: true })
    expect(retrievalRange(metadata)).toEqual({ first: '2026-10-24T12:00:00Z', last: '2026-10-24T12:10:00Z', cached: 1 })
    expect(retrievalRange({ ...metadata, fetches: [] }).last).toBeNull()
  })
})

describe('chart integrity', () => {
  it('breaks paths at nulls instead of drawing through missing observations', () => {
    const rows = [100, null, 120, 0].map((value, i) => ({ time: `2026-01-01T0${i}:00:00Z`, values: [value] }))
    expect(linePath(rows, 0, (i) => i * 10, (value) => value, 3_600_000)).toBe('M0.00,100.00  M20.00,120.00 L30.00,0.00')
  })
  it('breaks paths across absent timestamps and handles negative/zero domains', () => {
    const rows = [{ time: '2026-01-01T00:00:00Z', values: [-20] }, { time: '2026-01-01T03:00:00Z', values: [0] }]
    expect(linePath(rows, 0, (i) => i, (value) => value, 3_600_000)).not.toContain('L')
    expect(chartDomain(rows, false)[0]).toBeLessThan(-20)
    const [min, max] = chartDomain(rows, true)
    expect(min).toBe(-max)
    expect(chartDomain([{ time: rows[0].time, values: [0] }], false)[1]).toBeGreaterThan(0)
  })
})
