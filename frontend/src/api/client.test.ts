import { describe, expect, it, vi } from 'vitest'
import { ApiError, apiUrl, assertCoherent, createApi, policyParams, resolveApiBaseUrl } from './client'
import { makeDashboard, makeHistory, jsonResponse } from '../test/fixtures'

describe('typed API client', () => {
  it('uses the local proxy only outside production and normalizes configured roots', () => {
    expect(resolveApiBaseUrl(undefined, 'development')).toEqual({ baseUrl: '/backend', mode: 'development' })
    expect(resolveApiBaseUrl('/backend/', 'development')).toEqual({ baseUrl: '/backend', mode: 'development' })
    expect(resolveApiBaseUrl('https://api.example.test/v1///', 'production')).toEqual({ baseUrl: 'https://api.example.test/v1', mode: 'production' })
    expect(() => resolveApiBaseUrl(undefined, 'production')).toThrow(/configuration is missing/)
    expect(() => resolveApiBaseUrl('/backend', 'production')).toThrow(/absolute HTTPS/)
    expect(() => resolveApiBaseUrl('http://api.example.test', 'production')).toThrow(/absolute HTTPS/)
    expect(() => resolveApiBaseUrl('https://user:pass@api.example.test', 'production')).toThrow(/absolute HTTPS/)
  })

  it('builds safe same-origin and absolute URLs without credentials', () => {
    expect(apiUrl('/backend', '/health', { market: 'n2ex', empty: '' })).toBe('/backend/health?market=n2ex&empty=')
    expect(apiUrl('https://api.example.test/v1', '/health')).toBe('https://api.example.test/v1/health')
    expect(() => apiUrl('javascript:alert(1)', '/health')).toThrow(ApiError)
    expect(policyParams({ comparison_mode: 'unverified', cutoff_inclusive: false })).toEqual({ comparison_mode: 'unverified', cutoff_inclusive: 'false' })
  })

  it('parses live-shaped health, history, and dashboard response envelopes', async () => {
    const dashboard = makeDashboard()
    const history = makeHistory()
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), 'http://localhost').pathname
      if (path.endsWith('/health')) return jsonResponse({ status: 'ok', scope: 'process_liveness_only' })
      if (path.endsWith('/publications')) return jsonResponse(history)
      if (path.endsWith('/summary')) return jsonResponse(dashboard.summary)
      if (path.endsWith('/series')) return jsonResponse(dashboard.series)
      return jsonResponse(dashboard.errors)
    })
    const client = createApi('/backend', fetcher)
    await expect(client.health()).resolves.toEqual({ status: 'ok', scope: 'process_liveness_only' })
    await expect(client.publications('2026-01-01T00:00:00Z', { comparison_mode: 'unverified' })).resolves.toEqual(history)
    await expect(client.dashboard({ comparison_mode: 'unverified' })).resolves.toEqual(dashboard)
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('/backend/api/v1/wind/summary?'), expect.objectContaining({ credentials: 'omit' }))
  })

  it('surfaces typed API failures and Retry-After instead of fabricating fallback results', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ code: 'upstream_rate_limited', message: 'Retry later', retry_after_seconds: 3 }), {
      status: 503, headers: { 'Content-Type': 'application/json', 'Retry-After': '3' },
    }))
    const client = createApi('/backend', fetcher, 1000)
    await expect(client.health()).rejects.toMatchObject({ status: 503, code: 'upstream_rate_limited', message: 'Retry later' })
    const error = await client.health().catch((value: unknown) => value)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).retryAt).toBeGreaterThan(Date.now())
  })

  it('rejects malformed successful responses and incoherent multi-endpoint snapshots', async () => {
    const malformed = createApi('/backend', vi.fn(async () => jsonResponse({ status: 'ok' })))
    await expect(malformed.health()).rejects.toMatchObject({ code: 'invalid_response' })
    const first = makeDashboard()
    const second = makeDashboard(true)
    expect(() => assertCoherent({ summary: first.summary, series: second.series, errors: first.errors }, { comparison_mode: 'unverified' })).toThrow(/consistent analysis/)
  })
})
