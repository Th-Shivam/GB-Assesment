import { useState } from 'react'
import type { Market, Policy } from '../api/schemas'
import { Icon } from './Icon'

export function PolicyControls({ onApply }: { onApply: (policy: Policy) => void }) {
  const [market, setMarket] = useState<Market | ''>('')
  const [time, setTime] = useState('')
  const [boundary, setBoundary] = useState('')
  const [conditional, setConditional] = useState(false)
  return <form className="panel policy-panel" aria-label="Analysis policy" onSubmit={(event) => {
    event.preventDefault()
    onApply({
      market: market || undefined,
      decision_time: time || undefined,
      cutoff_inclusive: boundary === '' ? undefined : boundary === 'inclusive',
      comparison_mode: conditional ? 'hourly_average_assumption' : 'unverified',
    })
  }}>
    <div className="section-heading compact"><div><h2><Icon name="clock" />Decision policy</h2><p>Changes take effect after applying. Named market gates are scenario defaults, not procurement requirements.</p></div></div>
    <div className="policy-fields">
      <label>Market scenario<select value={market} onChange={(event) => setMarket(event.target.value as Market | '')}>
        <option value="">Backend default</option><option value="n2ex">Nord Pool N2EX</option>
        <option value="epex">EPEX day-ahead</option><option value="custom">Custom decision</option>
      </select></label>
      <label>Decision time · UK, D−1<input type="time" value={time} onChange={(event) => setTime(event.target.value)} required={market === 'custom'} step="60" aria-describedby="decision-time-help" /></label>
      <label>Publication boundary<select value={boundary} onChange={(event) => setBoundary(event.target.value)}>
        <option value="">Backend default</option><option value="inclusive">At or before cutoff (≤)</option><option value="strict">Strictly before cutoff (&lt;)</option>
      </select></label>
      <button className="button primary" type="submit">Apply policy<Icon name="arrow" /></button>
    </div>
    <p id="decision-time-help" className="small muted">Leave time blank to use the configured backend decision time. A named-market override cannot be later than its gate.</p>
    <div className="assumption-control">
      <label className="checkbox-label"><input type="checkbox" checked={conditional} onChange={(event) => setConditional(event.target.checked)} aria-describedby="assumption-help" />
        <span>Enable conditional hourly-average comparison</span></label>
      <p id="assumption-help">Explicitly assume each WINDFOR value is mean MW over the following hour. This is unverified; resulting scores are conditional, not definitive.</p>
    </div>
  </form>
}
