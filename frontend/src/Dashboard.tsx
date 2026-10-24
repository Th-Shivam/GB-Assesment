import { useCallback, useState } from 'react'
import { api, apiConfigurationError } from './api/client'
import type { DashboardData, Policy } from './api/schemas'
import { ComparisonTable } from './components/ComparisonTable'
import { EmptyState, ErrorState, Loading } from './components/Feedback'
import { Icon } from './components/Icon'
import { KpiCards } from './components/KpiCards'
import { Methodology, MethodologyNotice } from './components/Methodology'
import { PolicyControls } from './components/PolicyControls'
import { PublicationHistory } from './components/PublicationHistory'
import { TimeSeriesChart } from './components/TimeSeriesChart'
import { useResource } from './hooks/useResource'
import { coverageStatus, metricsAvailable, metricStatus, retrievalRange } from './lib/analysis'
import { formatDay, formatNumber, formatTimestamp, ukDay } from './lib/format'

const januaryDays = Array.from({ length: 31 }, (_, i) => `2026-01-${String(i + 1).padStart(2, '0')}`)
const fallbackConfigurationError = new Error('The frontend API configuration is unavailable.')

function Analysis({ data, policy }: { data: DashboardData; policy: Policy }) {
  const [day, setDay] = useState('all')
  const [target, setTarget] = useState('2026-01-01T00:00:00Z')
  const { summary, series, errors } = data
  const { metadata, quality } = summary
  const conditional = metricsAvailable(metadata, summary.metrics)
  const coverage = coverageStatus(quality)
  const retrieval = retrievalRange(metadata)
  const points = day === 'all' ? series.data : series.data.filter((point) => ukDay(point.start_time) === day)
  const reviewHours = series.data.filter((point) => point.issues.some((issue) => issue !== 'forecast_semantics_unverified')).length

  function showHistory(value: string) {
    setTarget(value)
    document.getElementById('publications')?.scrollIntoView({ behavior: 'auto', block: 'start' })
    document.getElementById('publication-heading')?.focus({ preventScroll: true })
  }

  return <>
    <MethodologyNotice summary={summary} />
    <section className="panel retrieval-panel" aria-label="Data retrieval and coverage">
      <div className="retrieval-top"><div className="status-line"><span className={`status-dot ${coverage === 'complete' ? 'green' : 'amber'}`} />
        <strong>{coverage === 'complete' ? 'Retrieval complete · full data-pair coverage' : coverage === 'partial' ? 'Retrieval complete · partial data coverage' : 'Retrieval complete · no usable observations'}</strong></div>
        <span className="small muted">{metadata.fetches.length} source batches · {retrieval.cached} cached</span></div>
      <div className="coverage-grid">
        <div><span>Actual half-hours</span><strong>{formatNumber(quality.usable_actual_half_hours, 0)} <small>/ {formatNumber(quality.expected_half_hours, 0)}</small></strong></div>
        <div><span>Eligible forecast hours</span><strong>{formatNumber(quality.usable_forecast_hours, 0)} <small>/ {formatNumber(quality.expected_hours, 0)}</small></strong></div>
        <div><span>Available data pairs</span><strong>{formatNumber(quality.available_pair_coverage_percent)}<small>% · {formatNumber(quality.available_pairs, 0)} pairs</small></strong></div>
        <div><span>Evaluated pairs</span><strong>{formatNumber(quality.evaluated_pairs, 0)}<small>{conditional ? ' · conditional' : ' · metrics withheld'}</small></strong></div>
      </div>
      <div className="retrieval-bottom"><span>Source retrieval: {formatTimestamp(retrieval.first)} → {formatTimestamp(retrieval.last)}. Cache hits retain their original retrieval time.</span>
        {reviewHours > 0 && <strong className="amber-text">{reviewHours} hours have data-quality flags</strong>}</div>
    </section>
    {coverage !== 'complete' && <div className="data-warning" role="status">{coverage === 'empty' ? 'No usable source observations were returned.' : 'Some expected observations are unavailable.'} Charts retain gaps; averages use only available values and are not complete-month totals. See the comparison table and quality details.</div>}
    <div className="section-overline"><span>JANUARY 2026 · MONTH-WIDE INDICATORS</span><span>Generation in MW, not MWh</span></div>
    <KpiCards summary={summary} series={series} />

    <section id="generation" className="panel chart-panel">
      <div className="section-heading"><div><p className="eyebrow">GENERATION OVERVIEW</p><h2>Actual vs forecast</h2><p>Operationally visible GB wind · {day === 'all' ? '01–31 January 2026' : `${formatDay(day)} 2026`}</p></div>
        <label className="compact-label">Chart & comparison view<select value={day} onChange={(event) => setDay(event.target.value)}>
          <option value="all">Full January</option>{januaryDays.map((value) => <option key={value} value={value}>{formatDay(value)} 2026</option>)}
        </select></label></div>
      <div className="applied-policy"><Icon name="clock" /><span>Applied: <strong>{metadata.market.toUpperCase()} · {metadata.effective_decision_time} UK on D−1</strong> · {metadata.cutoff_inclusive ? 'at or before cutoff (≤)' : 'strictly before cutoff (<)'}</span><span className="badge">{metadata.comparison_mode === 'unverified' ? 'Descriptive view · no accuracy claim' : 'Conditional comparison'}</span></div>
      <TimeSeriesChart key={day} label="Actual versus forecast generation" rows={points.map((point) => ({ time: point.start_time, values: [point.actual_mw, point.forecast_mw] }))}
        traces={[{ name: 'Actual · hourly mean', colour: '#7fe0ae' }, { name: 'Forecast · hourly target', colour: '#a6b9d2', dashed: true }]} />
      <p className="chart-footnote">Actual means require both half-hours. Forecast averaging semantics remain unverified. Line segments are visual guides between native targets—not interpolated observations or half-hour forecasts. Indicators above remain month-wide.</p>
    </section>

    <section id="errors" className="panel chart-panel">
      <div className="section-heading"><div><p className="eyebrow">ERROR ANALYSIS</p><h2>Daily signed forecast error</h2><p>Mean of evaluated hourly errors · forecast minus actual · full January</p></div><span className="badge amber">{conditional ? 'Conditional · assumption-dependent' : 'Accuracy unavailable'}</span></div>
      {conditional ? <><TimeSeriesChart label="Conditional daily signed error" daily bars
        rows={errors.by_day.map((item) => ({ time: `${item.delivery_date}T00:00:00Z`, values: [metricsAvailable(errors.metadata, item.metrics) ? item.metrics.signed_bias_mw : null] }))}
        traces={[{ name: 'Conditional signed bias', colour: '#d9b276' }]} />
        <p className="chart-footnote">Positive values indicate over-forecast wind; negative values indicate under-forecast wind. Daily bias can conceal offsetting hourly errors. All values depend on the unverified hourly-average assumption; gaps are not zero.</p></> :
        <EmptyState title={summary.metrics.status === 'no_valid_pairs' ? 'No valid pairs to evaluate' : 'Accuracy metrics unavailable'}>{metricStatus(metadata, summary.metrics)} Enable the explicit assumption in Decision policy only if that interpretation is appropriate for your analysis.</EmptyState>}
    </section>
    <ComparisonTable key={day} points={points} conditional={conditional} onHistory={showHistory} />
    <PublicationHistory policy={policy} target={target} onTarget={setTarget} />
    <Methodology summary={summary} />
  </>
}

export function Dashboard() {
  // Always request unverified explicitly, even if a server operator changed the
  // deployment default. Only a user action can opt this browser into assumptions.
  const [policy, setPolicy] = useState<Policy>({ comparison_mode: 'unverified' })
  const load = useCallback((signal: AbortSignal) => api
    ? api.dashboard(policy, signal)
    : Promise.reject(apiConfigurationError ?? fallbackConfigurationError), [policy])
  const resource = useResource(JSON.stringify(policy), load)
  const healthLoad = useCallback((signal: AbortSignal) => api
    ? api.health(signal)
    : Promise.reject(apiConfigurationError ?? fallbackConfigurationError), [])
  const health = useResource('health', healthLoad)

  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to analysis</a>
    <aside className="sidebar" aria-label="Workspace navigation">
      <a className="brand" href="#overview"><span className="brand-symbol"><Icon name="wind" /></span><span>WIND<span className="brand-light">DESK</span><small>GB MARKET ANALYTICS</small></span></a>
      <div className="workspace-label">RESEARCH WORKSPACE<span>January 2026</span></div>
      <nav aria-label="Dashboard sections">
        <a href="#overview" className="nav-overview"><Icon name="grid" />Overview</a>
        <a href="#generation"><Icon name="chart" />Generation</a>
        <a href="#errors"><Icon name="chart" />Forecast errors</a>
        <a href="#comparison"><Icon name="grid" />Comparison</a>
        <a href="#publications"><Icon name="clock" />Publications</a>
        <a href="#methodology"><Icon name="book" />Methodology</a>
      </nav>
      <div className="sidebar-source"><span className="eyebrow">SOURCE DATA</span><strong>Elexon BMRS</strong><p>FUELHH + WINDFOR</p><span className="badge">Historical analysis</span><p className="small">Great Britain<br />Operationally visible wind</p></div>
    </aside>
    <div className="workspace">
      <header className="topbar"><span><span className="muted">Markets</span><span className="breadcrumb-slash">/</span>Great Britain<span className="breadcrumb-slash">/</span><strong>Wind</strong></span>
        <span className="api-status" title="Health checks process liveness only, not Elexon connectivity or data completeness."><span className={`status-dot ${health.status === 'success' ? 'green' : health.status === 'error' ? 'amber' : ''}`} />
          {health.status === 'success' ? 'API responding · liveness only' : health.status === 'error' ? 'API health check failed' : 'Checking API liveness'}</span>
      </header>
      <main id="main-content">
        <section className="page-heading" id="overview"><div><p className="eyebrow">UK WIND FORECAST ANALYTICS</p><h1>A clearer view of wind.</h1><p>Day-ahead forecasts, observed generation, and the assumptions between them.</p></div>
          <div className="heading-actions"><span className="date-chip"><Icon name="calendar" />01–31 Jan 2026</span><button className="button" onClick={() => { resource.retry(); health.retry() }} disabled={resource.status !== 'success'}><Icon name="refresh" />Refresh</button></div>
        </section>
        <PolicyControls onApply={(next) => {
          if (JSON.stringify(next) === JSON.stringify(policy)) resource.retry()
          else setPolicy(next)
        }} />
        {resource.status === 'loading' && <div className="panel"><Loading /></div>}
        {resource.status === 'error' && <div className="panel"><ErrorState error={resource.error} retry={() => { resource.retry(); health.retry() }} /></div>}
        {resource.status === 'success' && <Analysis key={JSON.stringify(policy)} data={resource.data} policy={policy} />}
        <footer className="footer"><span><Icon name="wind" />WIND DESK <span className="muted">/ UK Wind Forecast Analytics</span></span><span>January 2026 archive · UK local time · MW</span></footer>
      </main>
    </div>
  </div>
}
