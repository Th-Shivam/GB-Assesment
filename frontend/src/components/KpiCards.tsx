import type { SeriesResponse, SummaryResponse } from '../api/schemas'
import { availableMean, formatNumber } from '../lib/format'
import { metricsAvailable } from '../lib/analysis'

export function KpiCards({ summary, series }: { summary: SummaryResponse; series: SeriesResponse }) {
  const available = metricsAvailable(summary.metadata, summary.metrics)
  const actual = availableMean(series.data.map((point) => point.actual_mw))
  const forecast = availableMean(series.data.map((point) => point.forecast_mw))
  const scores = [
    { name: 'Mean absolute error', short: 'MAE', value: summary.metrics.mae_mw, note: 'Typical absolute forecast error', signed: false },
    { name: 'Root mean square error', short: 'RMSE', value: summary.metrics.rmse_mw, note: 'Greater weight on larger errors', signed: false },
    { name: 'Signed bias', short: 'BIAS', value: summary.metrics.signed_bias_mw, note: 'Positive = over-forecast wind', signed: true },
  ]
  return <section className="kpi-grid" aria-label="January generation and accuracy indicators">
    {scores.map((score) => <article className="panel kpi" key={score.short}>
      <div className="kpi-top"><span>{score.short}</span><span className="badge amber">{available ? 'Conditional' : 'Unavailable'}</span></div>
      <h2>{score.name}</h2>
      <div className="kpi-value">{formatNumber(available ? score.value : null, 1, score.signed)}<span>MW</span></div>
      <p>{available ? score.note : summary.metrics.status === 'no_valid_pairs' ? 'No valid evaluation pairs' : 'Averaging semantics unverified'}</p>
    </article>)}
    {[{ name: 'Mean actual generation', data: actual, style: 'actual', note: 'Complete hourly actual means' },
      { name: 'Mean forecast generation', data: forecast, style: 'forecast', note: 'Selected native hourly targets' }].map((item) => <article className={`panel kpi ${item.style}`} key={item.name}>
        <div className="kpi-top"><span>{item.style === 'actual' ? 'FUELHH' : 'WINDFOR'}</span><span className="line-key" /></div>
        <h2>{item.name}</h2><div className="kpi-value">{formatNumber(item.data.mean)}<span>MW</span></div>
        <p>{formatNumber(item.data.count, 0)} available hours · separate cohort</p><p className="small muted">{item.note}</p>
      </article>)}
  </section>
}
