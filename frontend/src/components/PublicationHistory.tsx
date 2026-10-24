import { useCallback, useState } from 'react'
import { api } from '../api/client'
import type { HistoryResponse, Policy } from '../api/schemas'
import { useResource } from '../hooks/useResource'
import { formatNumber, formatTimestamp, issueLabel } from '../lib/format'
import { EmptyState, ErrorState, Loading, Pagination } from './Feedback'

function HistoryTable({ history }: { history: HistoryResponse }) {
  const [page, setPage] = useState(0)
  const rows = [...history.data].sort((a, b) => Date.parse(b.publish_time) - Date.parse(a.publish_time))
  return <>
    <div className="history-policy"><span>Delivery <strong>{formatTimestamp(history.target)}</strong></span><span>Decision cutoff <strong>{formatTimestamp(history.decision_cutoff)}</strong></span>
      <span className="badge">{history.metadata.market.toUpperCase()} · {history.metadata.cutoff_inclusive ? '≤ inclusive' : '< strict'}</span></div>
    {history.status === 'empty' || !rows.length ? <EmptyState title="No publications in searched history">The bounded search returned no records for this target. This does not establish that no forecast ever existed.</EmptyState> : <>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Forecast publication history table; scroll horizontally on small screens"><table>
        <caption className="sr-only">Forecast publications for one delivery target; newest first. All timestamps use UK local time. Selected means selected record key, not necessarily a usable value.</caption>
        <thead><tr><th scope="col">Delivery time · UK</th><th scope="col">Publication time · UK</th><th scope="col" className="numeric">Generation · MW</th><th scope="col">Cutoff eligibility</th><th scope="col">Selection / quality</th></tr></thead>
        <tbody>{rows.slice(page * 8, (page + 1) * 8).map((row) => <tr key={row.publish_time} className={row.selected ? 'selected-row' : ''}>
          <td className="time-cell">{formatTimestamp(row.start_time)}</td><th scope="row" className="time-cell">{formatTimestamp(row.publish_time)}</th>
          <td className="numeric">{formatNumber(row.generation_mw)}</td><td><span className={`badge ${row.eligible ? 'green' : ''}`}>{row.eligible ? 'Eligible' : 'Ineligible'}</span></td>
          <td>{row.selected && <span className="badge green">Selected key</span>}{!row.selected && !row.issues.length && 'Not selected'}
            {row.issues.map((issue) => <span className="cell-detail" key={issue}>{issueLabel(issue)}</span>)}{row.duplicate_rows > 0 && <span className="cell-detail">{row.duplicate_rows} duplicate rows collapsed</span>}</td>
        </tr>)}</tbody>
      </table></div><Pagination page={page} total={rows.length} pageSize={8} onChange={setPage} label="Publication history" />
    </>}
    <p className="table-note">Search bounds: {formatTimestamp(history.metadata.publication_search_start)} → {formatTimestamp(history.metadata.publication_search_end)}. Later publications are visible but excluded from the decision. A selected null/conflicted key stays unusable; it is not replaced with an older forecast.</p>
  </>
}

export function PublicationHistory({ policy, target, onTarget }: { policy: Policy; target: string; onTarget: (target: string) => void }) {
  const load = useCallback((signal: AbortSignal) => api.publications(target, policy, signal), [target, policy])
  const resource = useResource(`${JSON.stringify(policy)}:${target}`, load)
  // January is GMT. These constrained controls deliberately create UTC instants,
  // never browser-local Date objects or a general-purpose DST conversion.
  const day = target.slice(0, 10)
  const hour = target.slice(11, 13)
  return <section id="publications" className="panel table-panel">
    <div className="section-heading"><div><p className="eyebrow">FORECAST VINTAGES</p><h2 id="publication-heading" tabIndex={-1}>Publication history</h2><p>See what was published before—and after—the decision cutoff.</p></div>
      <div className="history-controls"><label className="compact-label">Delivery date · UK<input type="date" min="2026-01-01" max="2026-01-31" value={day} onChange={(event) => {
        if (/^2026-01-(0[1-9]|[12]\d|3[01])$/.test(event.target.value)) onTarget(`${event.target.value}T${hour}:00:00Z`)
      }} /></label><label className="compact-label">Hour · GMT<select value={hour} onChange={(event) => onTarget(`${day}T${event.target.value}:00:00Z`)}>
        {Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0')).map((value) => <option key={value} value={value}>{value}:00</option>)}
      </select></label></div></div>
    {resource.status === 'loading' && <Loading label="Retrieving publication history" />}
    {resource.status === 'error' && <ErrorState error={resource.error} retry={resource.retry} title="Publication history could not be retrieved" />}
    {resource.status === 'success' && <HistoryTable key={`${target}:${JSON.stringify(policy)}`} history={resource.data} />}
    <p className="table-note">As-published reconstruction only. Publication time is not evidence of actual trader receipt.</p>
  </section>
}
