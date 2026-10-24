export interface ChartRow { time: string; values: (number | null)[] }

export function linePath(rows: ChartRow[], series: number, x: (index: number) => number, y: (value: number) => number, cadenceMs: number): string {
  let previous: number | null = null
  return rows.map((row, index) => {
    const value = row.values[series]
    if (value === null || value === undefined || !Number.isFinite(value)) { previous = null; return '' }
    const instant = Date.parse(row.time)
    const command = previous === null || instant - previous > cadenceMs ? 'M' : 'L'
    previous = instant
    return `${command}${x(index).toFixed(2)},${y(value).toFixed(2)}`
  }).join(' ')
}

export function chartDomain(rows: ChartRow[], symmetric: boolean): [number, number] {
  const values = rows.flatMap((row) => row.values.filter((value): value is number => value !== null && Number.isFinite(value)))
  if (!values.length) return [0, 1]
  const minimum = Math.min(0, ...values)
  const maximum = Math.max(0, ...values)
  const span = Math.max(1, maximum - minimum)
  const step = 10 ** Math.floor(Math.log10(span)) / 2
  const upper = Math.max(step, Math.ceil((maximum + span * 0.08) / step) * step)
  const lower = minimum < 0 ? Math.floor((minimum - span * 0.08) / step) * step : 0
  if (symmetric) { const limit = Math.max(Math.abs(lower), upper); return [-limit, limit] }
  return [lower, upper]
}
