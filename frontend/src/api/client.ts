import type { z } from 'zod'
import {
  errorAnalysisSchema, errorSchema, healthSchema, historySchema, seriesSchema, summarySchema,
} from './schemas'
import type { DashboardData, Metadata, Policy } from './schemas'

export class ApiError extends Error {
  readonly retryAt: number | null

  constructor(message: string, readonly status = 0, readonly code = 'network_error', retrySeconds: number | null = null) {
    super(message)
    this.name = 'ApiError'
    this.retryAt = retrySeconds === null ? null : Date.now() + Math.max(0, retrySeconds) * 1000
  }
}

export interface ApiBaseConfig {
  baseUrl: string
  mode: 'development' | 'production'
}

function absoluteApiUrl(value: string): URL | null {
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null
    return url
  } catch {
    return null
  }
}

export function resolveApiBaseUrl(value: string | undefined, mode: string): ApiBaseConfig {
  const configured = value?.trim().replace(/\/+$/, '') || ''
  if (mode !== 'production' && configured === '') return { baseUrl: '/backend', mode: 'development' }
  if (mode === 'production' && configured === '') {
    throw new ApiError('Production API configuration is missing. Set VITE_API_BASE_URL to the deployed HTTPS backend URL before building.', 0, 'configuration_error')
  }
  if (configured.startsWith('/')) {
    if (mode === 'production') {
      throw new ApiError('Invalid production API configuration. VITE_API_BASE_URL must be an absolute HTTPS backend URL with no credentials, query, or fragment.', 0, 'configuration_error')
    }
    if (!/^\/(?!\/)[^?#]*$/.test(configured)) {
      throw new ApiError('Invalid VITE_API_BASE_URL. Use an HTTP(S) API root or a same-origin path.', 0, 'configuration_error')
    }
    return { baseUrl: configured, mode: 'development' }
  }
  const url = absoluteApiUrl(configured)
  if (!url || (mode === 'production' && url.protocol !== 'https:')) {
    throw new ApiError(
      mode === 'production'
        ? 'Invalid production API configuration. VITE_API_BASE_URL must be an absolute HTTPS backend URL with no credentials, query, or fragment.'
        : 'Invalid VITE_API_BASE_URL. Use an HTTP(S) API root or a same-origin path.',
      0, 'configuration_error',
    )
  }
  return { baseUrl: url.toString().replace(/\/+$/, ''), mode: mode === 'production' ? 'production' : 'development' }
}

export function apiUrl(base: string, path: string, parameters: Record<string, string> = {}): string {
  const root = base.trim().replace(/\/+$/, '')
  const validRelative = /^\/(?!\/)[^?#]*$/.test(root)
  if (!validRelative && !absoluteApiUrl(root) && root !== '') {
    throw new ApiError('Invalid VITE_API_BASE_URL. Use an HTTP(S) API root or a same-origin path.', 0, 'configuration_error')
  }
  const search = new URLSearchParams(parameters).toString()
  return `${root}${path}${search ? `?${search}` : ''}`
}

export function policyParams(policy: Policy): Record<string, string> {
  return Object.fromEntries(Object.entries(policy)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => [key, String(value)]))
}

function retrySeconds(response: Response): number | null {
  const raw = response.headers.get('Retry-After')
  if (raw === null) return null
  const numeric = Number(raw)
  if (Number.isFinite(numeric)) return Math.max(0, numeric)
  const date = Date.parse(raw)
  return Number.isFinite(date) ? Math.max(0, Math.ceil((date - Date.now()) / 1000)) : null
}

function validationMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object' || !('detail' in body)) return null
  if (typeof body.detail === 'string') return body.detail
  if (Array.isArray(body.detail)) {
    return body.detail.slice(0, 3).map((item: unknown) =>
      item && typeof item === 'object' && 'msg' in item && typeof item.msg === 'string' ? item.msg : 'Invalid query value',
    ).join('; ')
  }
  return null
}

// Separate endpoints must describe the same extraction and policy, not a mix
// of cached/new snapshots. Cache-hit flags can differ; source checksums cannot.
function snapshotKey(metadata: Metadata): string {
  const { fetches, warnings: _warnings, ...policy } = metadata
  return JSON.stringify([policy, fetches.map((f) => `${f.dataset}:${f.request_url}:${f.sha256}`).sort()])
}

export function assertCoherent(data: DashboardData, policy: Policy): DashboardData {
  const { summary, series, errors } = data
  const key = snapshotKey(summary.metadata)
  if ([series, errors].some((item) => snapshotKey(item.metadata) !== key ||
    JSON.stringify(item.metrics) !== JSON.stringify(summary.metrics) ||
    JSON.stringify(item.quality) !== JSON.stringify(summary.quality)) ||
    summary.metadata.comparison_mode !== policy.comparison_mode ||
    (policy.comparison_mode === 'unverified' && summary.metrics.status !== 'semantics_unverified')) {
    throw new ApiError('The API responses do not describe one consistent analysis. Retry to retrieve a matching snapshot.', 0, 'inconsistent_snapshot')
  }
  return data
}

export function createApi(base: string, fetcher: typeof fetch = (...args) => fetch(...args), timeoutMs = 180_000) {
  async function request<T>(path: string, schema: z.ZodType<T>, params: Record<string, string>, signal?: AbortSignal): Promise<T> {
    const controller = new AbortController()
    const cancel = () => controller.abort()
    if (signal?.aborted) controller.abort()
    signal?.addEventListener('abort', cancel, { once: true })
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
    try {
      const response = await fetcher(apiUrl(base, path, params), {
        signal: controller.signal, headers: { Accept: 'application/json' }, credentials: 'omit',
      })
      let body: unknown
      try { body = await response.json() } catch { body = null }
      if (!response.ok) {
        const failure = errorSchema.safeParse(body)
        throw new ApiError(
          failure.success ? failure.data.message : (validationMessage(body) || `The API returned HTTP ${response.status}. Check that FastAPI and the local proxy are running.`),
          response.status, failure.success ? failure.data.code : 'http_error',
          failure.success ? failure.data.retry_after_seconds ?? retrySeconds(response) : retrySeconds(response),
        )
      }
      const parsed = schema.safeParse(body)
      if (!parsed.success) throw new ApiError('The API returned an unexpected or incomplete response. No values have been substituted.', response.status, 'invalid_response')
      return parsed.data
    } catch (error) {
      if (signal?.aborted) throw error
      if (timedOut) throw new ApiError(`The analysis request timed out after ${Math.ceil(timeoutMs / 1000)} seconds. Retry when the upstream service is available.`, 0, 'timeout')
      if (error instanceof ApiError) throw error
      throw new ApiError('Could not reach the API. Check FastAPI, VITE_API_BASE_URL, and the local proxy, then retry.')
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', cancel)
    }
  }

  return {
    health: (signal?: AbortSignal) => request('/health', healthSchema, {}, signal),
    async dashboard(policy: Policy, signal?: AbortSignal): Promise<DashboardData> {
      const params = { start_date: '2026-01-01', end_date: '2026-01-31', ...policyParams(policy) }
      const [summary, series, errors] = await Promise.all([
        request('/api/v1/wind/summary', summarySchema, params, signal),
        request('/api/v1/wind/series', seriesSchema, params, signal),
        request('/api/v1/wind/errors', errorAnalysisSchema, params, signal),
      ])
      return assertCoherent({ summary, series, errors }, policy)
    },
    publications: (target: string, policy: Policy, signal?: AbortSignal) =>
      request('/api/v1/wind/publications', historySchema, { target, ...policyParams(policy) }, signal),
  }
}

export type ApiClient = ReturnType<typeof createApi>

// Keep configuration failure inside the rendered application so a production
// build shows a useful setup message instead of failing on an unhandled module
// exception or silently attempting the local proxy.
let configuredApi: ApiClient | null = null
let configurationFailure: ApiError | null = null
try {
  configuredApi = createApi(resolveApiBaseUrl(import.meta.env.VITE_API_BASE_URL, import.meta.env.MODE).baseUrl)
} catch (error) {
  configurationFailure = error instanceof ApiError
    ? error
    : new ApiError('The frontend API configuration is invalid. Set VITE_API_BASE_URL and rebuild.', 0, 'configuration_error')
}

export const api = configuredApi
export const apiConfigurationError = configurationFailure
