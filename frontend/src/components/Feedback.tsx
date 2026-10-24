import { useEffect, useState } from 'react'
import { ApiError } from '../api/client'
import { Icon } from './Icon'

export function Loading({ label = 'Retrieving January analysis' }: { label?: string }) {
  return <div className="feedback loading" role="status">
    <span className="loading-ring" aria-hidden="true" />
    <h3>{label}</h3>
    <p>Waiting for validated API responses. A cold cache may require daily Elexon requests.</p>
    <p className="small muted">No values are shown until retrieval succeeds.</p>
  </div>
}

export function EmptyState({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="feedback empty"><Icon name="chart" /><h3>{title}</h3><p>{children}</p></div>
}

export function ErrorState({ error, retry, title = 'Analysis could not be retrieved' }: { error: Error; retry: () => void; title?: string }) {
  const retryAt = error instanceof ApiError ? error.retryAt : null
  const [now, setNow] = useState(Date.now)
  const seconds = retryAt ? Math.max(0, Math.ceil((retryAt - now) / 1000)) : 0
  useEffect(() => {
    if (!retryAt) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [retryAt])
  return <div className="feedback error-state">
    <div role="alert"><h3>{title}</h3><p>{error.message}</p></div>
    {error instanceof ApiError && <p className="small muted">{error.status ? `HTTP ${error.status} · ` : ''}{error.code}</p>}
    <button className="button" onClick={retry} disabled={seconds > 0}>
      <Icon name="refresh" />{seconds > 0 ? `Retry in ${seconds}s` : 'Retry request'}
    </button>
    <p className="small muted">Failed requests are never replaced with example data.</p>
  </div>
}

export function Pagination({ page, total, pageSize, onChange, label }: {
  page: number; total: number; pageSize: number; onChange: (page: number) => void; label: string
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  return <nav className="pagination" aria-label={`${label} pagination`}>
    <span aria-live="polite">{total ? `${page * pageSize + 1}–${Math.min((page + 1) * pageSize, total)} of ${total}` : '0 rows'}</span>
    <div><button className="button small-button" disabled={page === 0} onClick={() => onChange(page - 1)}>Previous</button>
      <span className="page-number">{page + 1} / {pages}</span>
      <button className="button small-button" disabled={page + 1 >= pages} onClick={() => onChange(page + 1)}>Next</button></div>
  </nav>
}
