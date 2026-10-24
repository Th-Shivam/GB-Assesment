import { useState } from 'react'
import type { ComparisonPoint } from '../api/schemas'
import { formatDay, formatHour, formatMW, formatNumber, formatTimestamp, issueLabel } from '../lib/format'
import { EmptyState, Pagination } from './Feedback'

export function ComparisonTable({ points, conditional, onHistory }: { points: ComparisonPoint[]; conditional: boolean; onHistory: (target: string) => void }) {
  const [filter, setFilter] = useState('all')
  const [page, setPage] = useState(0)
  const rows = points.filter((point) => filter === 'all' || (filter === 'missing' ? !point.pair_available :
    point.issues.some((issue) => issue !== 'forecast_semantics_unverified')))
  const pageSize = 12
  const currentPage = Math.min(page, Math.max(0, Math.ceil(rows.length / pageSize) - 1))
  return <section className="panel table-panel" id="comparison">
    <div className="section-heading"><div><p className="eyebrow">DELIVERY-LEVEL DETAIL</p><h2>Hourly comparison</h2><p>Selected publications, native actual components and explicit gaps.</p></div>
      <label className="compact-label">Show rows<select value={filter} onChange={(event) => { setFilter(event.target.value); setPage(0) }}>
        <option value="all">All delivery hours</option><option value="missing">Missing pairs</option><option value="issues">Data-quality flags</option>
      </select></label></div>
    <p className="table-note">January 2026 · UK local time (GMT) · {conditional ? 'All errors are conditional on the hourly-average assumption.' : 'Errors withheld: forecast averaging semantics are unverified.'} Actual components are the :00 and :30 half-hours, in MW.</p>
    {!rows.length ? <EmptyState title="No matching delivery hours">No rows match this view. Choose a different day or row filter.</EmptyState> : <div className="table-scroll" tabIndex={0} role="region" aria-label="Hourly comparison table; scroll horizontally on small screens">
      <table><caption className="sr-only">Hourly wind comparison in MW, January 2026. Errors are {conditional ? 'conditional' : 'withheld'}. All timestamps use UK local time.</caption>
        <thead><tr><th scope="col">Delivery · GMT</th><th scope="col" className="numeric">Actual mean / half-hours</th><th scope="col" className="numeric">Forecast · MW</th>
          <th scope="col" className="numeric">{conditional ? 'Conditional error · MW' : 'Error · withheld'}</th><th scope="col">Published / cutoff · UK</th><th scope="col">Data status</th><th scope="col"><span className="sr-only">Publication history</span></th></tr></thead>
        <tbody>{rows.slice(currentPage * pageSize, (currentPage + 1) * pageSize).map((point) => {
          const issues = point.issues.filter((issue) => issue !== 'forecast_semantics_unverified')
          return <tr key={point.start_time}>
            <th scope="row"><time dateTime={point.start_time} title={formatTimestamp(point.start_time)}>{formatDay(point.start_time)}<span className="cell-detail">{formatHour(point.start_time)}–{formatHour(point.end_time)}</span></time></th>
            <td className="numeric"><span className="actual-text">{formatNumber(point.actual_mw)}</span><span className="cell-detail">{point.actual_half_hour_mw.map((value) => formatNumber(value, 0)).join(' / ')}</span></td>
            <td className="numeric">{formatNumber(point.forecast_mw)}<span className="cell-detail">{point.forecast_horizon_hours === null ? 'Horizon unavailable' : `${formatNumber(point.forecast_horizon_hours)} h horizon`}</span></td>
            <td className="numeric">{formatNumber(conditional && point.evaluated ? point.signed_error_mw : null, 1, true)}</td>
            <td className="time-cell">{formatTimestamp(point.forecast_publish_time)}<span className="cell-detail">Cutoff: {formatTimestamp(point.decision_cutoff)}</span></td>
            <td><span className={`badge ${!point.pair_available || issues.length ? 'amber' : ''}`}>{!point.pair_available ? 'Missing pair' : issues.length ? 'Review flags' : 'Pair available'}</span>
              {issues.map((issue) => <span key={issue} className="cell-detail">{issueLabel(issue)}</span>)}</td>
            <td><button className="text-button" aria-label={`View publications for ${formatTimestamp(point.start_time)}`} onClick={() => onHistory(point.start_time)}>History ↗</button></td>
          </tr>
        })}</tbody>
      </table>
    </div>}
    <Pagination page={currentPage} total={rows.length} pageSize={pageSize} onChange={setPage} label="Comparison" />
    <p className="table-note">A dash means unavailable, not zero. Forecast − actual defines the error sign. No missing value is filled; {formatMW(null)} is never an inferred observation.</p>
  </section>
}
