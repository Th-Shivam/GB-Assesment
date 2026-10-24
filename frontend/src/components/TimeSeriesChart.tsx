import { useEffect, useId, useRef, useState } from 'react'
import { chartDomain, linePath } from '../lib/chart'
import type { ChartRow } from '../lib/chart'
import { formatDay, formatHour, formatMW, formatNumber, formatTimestamp } from '../lib/format'
import { EmptyState } from './Feedback'

interface Trace { name: string; colour: string; dashed?: boolean }
interface Props { rows: ChartRow[]; traces: Trace[]; label: string; daily?: boolean; bars?: boolean }

export function TimeSeriesChart({ rows, traces, label, daily = false, bars = false }: Props) {
  const id = useId()
  const container = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(900)
  const [index, setIndex] = useState(0)
  useEffect(() => {
    if (!container.current) return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(280, entry.contentRect.width)))
    observer.observe(container.current)
    return () => observer.disconnect()
  }, [])

  const height = 256
  const left = width < 450 ? 48 : 60
  const right = 16
  const top = 22
  const bottom = 36
  const plotWidth = width - left - right
  const plotHeight = height - top - bottom
  const [min, max] = chartDomain(rows, bars)
  const start = rows.length ? Date.parse(rows[0].time) : 0
  const end = rows.length ? Date.parse(rows[rows.length - 1].time) : 1
  const x = (i: number) => rows.length === 1 ? left + plotWidth / 2 : left + (Date.parse(rows[i].time) - start) / Math.max(1, end - start) * plotWidth
  const y = (value: number) => top + (max - value) / (max - min) * plotHeight
  const active = Math.min(index, Math.max(0, rows.length - 1))
  const selected = rows[active]
  const hasValues = rows.some((row) => row.values.some((value) => value !== null))
  const tickCount = width < 500 ? 3 : 7
  const ticks = [...new Set(Array.from({ length: Math.min(tickCount, rows.length) }, (_, i) => Math.round(i * (rows.length - 1) / Math.max(1, Math.min(tickCount, rows.length) - 1))))]
  const sameDay = rows.length > 0 && formatDay(rows[0].time) === formatDay(rows[rows.length - 1].time)
  const describe = (row: ChartRow) => `${formatTimestamp(row.time)}. ${traces.map((trace, i) => `${trace.name}: ${formatMW(row.values[i], bars)}`).join('. ')}`

  function inspect(clientX: number, element: SVGSVGElement) {
    const rectangle = element.getBoundingClientRect()
    const position = (clientX - rectangle.left) / rectangle.width * width
    const instant = start + Math.max(0, Math.min(1, (position - left) / plotWidth)) * (end - start)
    let closest = 0
    rows.forEach((row, i) => { if (Math.abs(Date.parse(row.time) - instant) < Math.abs(Date.parse(rows[closest].time) - instant)) closest = i })
    setIndex(closest)
  }

  return <div className="chart" ref={container}>
    <div className="chart-legend">{traces.map((trace) => <span key={trace.name}><i style={{ borderColor: trace.colour, borderTopStyle: trace.dashed ? 'dashed' : 'solid' }} />{trace.name}</span>)}<span className="chart-unit">MW · UK local time (GMT)</span></div>
    {!hasValues ? <EmptyState title="No generation values to plot">The API returned no usable values for this view. Gaps are not filled or replaced.</EmptyState> : <>
      <svg className="plot" viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`${id}-title ${id}-description`}
        onPointerMove={(event) => inspect(event.clientX, event.currentTarget)} onPointerDown={(event) => inspect(event.clientX, event.currentTarget)}>
        <title id={`${id}-title`}>{label}</title><desc id={`${id}-description`}>Values in MW. Gaps are preserved. Use the inspection slider below for keyboard-accessible values; the comparison table provides hourly data.</desc>
        {Array.from({ length: 5 }, (_, i) => min + (max - min) * i / 4).map((value) => <g key={value}>
          <line className={Math.abs(value) < 0.001 ? 'zero-line' : 'grid-line'} x1={left} x2={width - right} y1={y(value)} y2={y(value)} />
          <text className="axis-text" x={left - 10} y={y(value) + 4} textAnchor="end">{formatNumber(value, 0)}</text>
        </g>)}
        {ticks.map((i) => <text className="axis-text" key={i} x={x(i)} y={height - 10} textAnchor={i === 0 ? 'start' : i === rows.length - 1 ? 'end' : 'middle'}>{sameDay && !daily ? formatHour(rows[i].time) : formatDay(rows[i].time)}</text>)}
        {bars ? rows.map((row, i) => row.values[0] === null ? null : <rect key={row.time} x={x(i) - Math.min(18, plotWidth / rows.length * 0.65) / 2}
          y={Math.min(y(row.values[0]), y(0))} width={Math.min(18, plotWidth / rows.length * 0.65)} height={Math.max(1, Math.abs(y(row.values[0]) - y(0)))}
          rx="2" fill={row.values[0] >= 0 ? '#d9b276' : '#8bacc9'} opacity={i === active ? 1 : 0.78} />) : traces.map((trace, i) => <path key={trace.name}
            d={linePath(rows, i, x, y, daily ? 86_400_000 : 3_600_000)} fill="none" stroke={trace.colour} strokeWidth="2" strokeDasharray={trace.dashed ? '5 4' : undefined} strokeLinejoin="round" />)}
        {selected && <g><line className="crosshair" x1={x(active)} x2={x(active)} y1={top} y2={height - bottom} />
          {!bars && traces.map((trace, i) => selected.values[i] === null ? null : <circle key={trace.name} cx={x(active)} cy={y(selected.values[i])} r="4" fill={trace.colour} stroke="#101b26" strokeWidth="2" />)}</g>}
      </svg>
      {selected && <div className="chart-readout" aria-live="polite" aria-atomic="true"><span className="readout-time">{formatTimestamp(selected.time)}</span>
        {traces.map((trace, i) => <span key={trace.name}><span className="muted">{trace.name}</span><strong>{formatMW(selected.values[i], bars)}</strong></span>)}</div>}
      <div className="chart-scrubber"><label htmlFor={`${id}-inspect`}>Inspect {daily ? 'day' : 'delivery hour'}</label>
        <input id={`${id}-inspect`} type="range" min="0" max={Math.max(0, rows.length - 1)} value={active} onChange={(event) => setIndex(Number(event.target.value))}
          aria-label={`${label}: inspect ${daily ? 'day' : 'delivery hour'}`} aria-valuetext={selected ? describe(selected) : 'No values'} />
        <span className="small muted">← → keys</span></div>
    </>}
  </div>
}
