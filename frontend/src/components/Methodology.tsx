import type { SummaryResponse } from '../api/schemas'
import { metricStatus } from '../lib/analysis'
import { formatNumber, formatTimestamp, issueLabel } from '../lib/format'
import { Icon } from './Icon'

export function MethodologyNotice({ summary }: { summary: SummaryResponse }) {
  const { metadata, metrics } = summary
  return <aside className="method-notice" aria-label="Accuracy interpretation">
    <Icon name="info" /><div><strong>{metricStatus(metadata, metrics)}</strong>
      <p>Actuals are hourly means of two FUELHH half-hours; WINDFOR values are native hourly targets. Publication time reconstructs published records, not actual trader receipt.</p></div>
    <a href="#methodology">Methodology <span aria-hidden="true">↗</span></a>
  </aside>
}

export function Methodology({ summary }: { summary: SummaryResponse }) {
  const { metadata: meta, quality } = summary
  return <section id="methodology" className="panel methodology">
    <div className="section-heading"><div><p className="eyebrow">INTERPRETATION & PROVENANCE</p><h2>Know what the data can tell you.</h2></div><span className="badge">Methodology v{meta.methodology_version}</span></div>
    <div className="method-grid">
      <article><span className="method-number">01</span><h3>As-published, not as-received</h3>
        <p>The latest eligible publication is selected independently for each delivery hour, within the returned search window. It must be {meta.cutoff_inclusive ? 'at or before' : 'strictly before'} the D−1 decision cutoff and strictly before delivery.</p>
        <p>Publication timestamps do not establish when a trader received a forecast, or whether a trade could have been executed.</p></article>
      <article><span className="method-number">02</span><h3>Two resolutions. One explicit assumption.</h3>
        <p>FUELHH reports half-hour mean MW. The displayed hourly actual is the mean of both half-hours; either missing half-hour leaves a gap. WINDFOR remains at its native hourly targets.</p>
        <p>Forecast point-versus-hour-average semantics are unverified. No forecast is duplicated or interpolated into half-hours; scores require explicit opt-in.</p></article>
      <article><span className="method-number">03</span><h3>Coverage is not accuracy</h3>
        <p>{meta.coverage_scope}. Outturn is the latest returned actual, not guaranteed final settlement data. Missing values are never filled with zeros.</p>
        <p>Mean generation cards use their own available-hour cohorts, not energy totals. Errors use forecast minus actual. No procurement savings or trading profit are inferred.</p></article>
    </div>
    <dl className="policy-details">
      <div><dt>Applied market</dt><dd>{meta.market.toUpperCase()}</dd></div>
      <div><dt>Market gate · UK D−1</dt><dd>{meta.market_gate_time ?? 'None · custom scenario'}</dd></div>
      <div><dt>Internal decision · UK D−1</dt><dd>{meta.internal_decision_time ?? 'Not configured'}</dd></div>
      <div><dt>Effective cutoff · UK D−1</dt><dd>{meta.effective_decision_time} · {meta.cutoff_inclusive ? 'inclusive (≤)' : 'strict (<)'}</dd></div>
      <div><dt>Timezone / units</dt><dd>{meta.decision_timezone} / {meta.units}</dd></div>
      <div><dt>Forecast semantics verified</dt><dd>No · including in conditional mode</dd></div>
    </dl>
    <details><summary>Source warnings, search bounds & quality details</summary>
      <ul className="warning-list">{meta.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
      <p className="small">Delivery range: {formatTimestamp(meta.delivery_start)} inclusive → {formatTimestamp(meta.delivery_end_exclusive)} exclusive.</p>
      <p className="small">Searched publication bounds: {formatTimestamp(meta.publication_search_start)} → {formatTimestamp(meta.publication_search_end)}. This is not a claim of exhaustive archive retention.</p>
      <p className="small">Actual / forecast duplicates: {quality.actual_duplicate_rows} / {quality.forecast_duplicate_rows}. Conflicting keys: {quality.actual_conflicting_keys} / {quality.forecast_conflicting_keys}.</p>
      <p className="small">Excluded reasons count affected hours and can overlap; do not sum them.</p>
      <ul className="warning-list">{Object.entries(quality.excluded_by_reason).map(([reason, count]) => <li key={reason}>{issueLabel(reason)}: {formatNumber(count, 0)}</li>)}</ul>
    </details>
  </section>
}
