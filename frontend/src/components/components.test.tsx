import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { KpiCards } from './KpiCards'
import { MethodologyNotice } from './Methodology'
import { makeDashboard } from '../test/fixtures'

describe('methodology-aware UI', () => {
  it('does not render missing default metrics as zeros', () => {
    const data = makeDashboard(false)
    render(<KpiCards summary={data.summary} series={data.series} />)
    expect(screen.getAllByText('—')).toHaveLength(3)
    expect(screen.getAllByText(/Averaging semantics unverified/)).toHaveLength(3)
    expect(screen.queryByText('0.0 MW')).not.toBeInTheDocument()
  })

  it('labels opt-in metrics as conditional and keeps semantics unverified', () => {
    const data = makeDashboard(true)
    render(<MethodologyNotice summary={data.summary} />)
    expect(screen.getByText(/Conditional accuracy metrics/)).toBeInTheDocument()
    expect(screen.getByText(/Publication time reconstructs published records/)).toBeInTheDocument()
    expect(screen.queryByText(/verified interval-average accuracy/)).not.toBeInTheDocument()
  })
})
