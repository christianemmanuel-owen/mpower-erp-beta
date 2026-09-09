// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { CartesianGrid, ComposedChart, Line, Scatter, XAxis, YAxis } from 'recharts'
import { supplierColor } from '../../lib/chartColors'
import { SERIES } from '../../lib/chartColors'

/**
 * Renders the same chart configuration as SupplierPriceChart and asserts that
 * a Scatter dot at timestamp t lands on the same x pixel as a Line vertex at t.
 */
describe('price chart x-alignment', () => {
  it('scatter dots land on the same x as line points for the same date', () => {
    const day = 86_400_000
    const start = Date.parse('2026-01-01')
    const end = Date.parse('2026-03-01')
    // Quote every 10 days; purchases exactly on two of those dates.
    const rows: Record<string, number>[] = []
    for (let t = start; t <= end; t += 10 * day) {
      const row: Record<string, number> = { t, q: 52 + ((t - start) / day) * 0.01 }
      if (t === start + 20 * day || t === start + 50 * day) row.b = row.q - 0.2
      rows.push(row)
    }

    const { container } = render(
      <ComposedChart width={800} height={220} data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
        <CartesianGrid vertical={false} />
        <XAxis type="number" dataKey="t" domain={[start, end]} />
        <YAxis type="number" domain={[50, 54]} width={52} />
        <Line dataKey="q" dot={{ r: 2 }} isAnimationActive={false} connectNulls />
        <Scatter dataKey="b" isAnimationActive={false} />
      </ComposedChart>,
    )

    // Line vertex dots carry class recharts-line-dot; scatter symbols sit in recharts-scatter layer.
    const lineDots = [...container.querySelectorAll('.recharts-line-dot')].map((el) =>
      Number(el.getAttribute('cx')),
    )
    const scatterEls = [...container.querySelectorAll('.recharts-scatter-symbol path, .recharts-scatter-symbol circle')]
    expect(lineDots.length).toBe(rows.length)
    expect(scatterEls.length).toBe(2)

    // Scatter x: symbols are <path> translated or with cx; read the layer's transform/position.
    const scatterXs = scatterEls.map((el) => {
      const cx = el.getAttribute('cx')
      if (cx) return Number(cx)
      const transform = el.getAttribute('transform') ?? ''
      const match = /translate\(([-\d.]+)/.exec(transform)
      if (match) return Number(match[1])
      // Symbol path centered via d attribute starting at M<x>,<y>
      const d = el.getAttribute('d') ?? ''
      const m = /M\s*([-\d.]+)/.exec(d)
      return m ? Number(m[1]) : NaN
    })

    const expected = [lineDots[2], lineDots[5]] // rows at +20d and +50d
    for (let i = 0; i < 2; i++) {
      expect(Math.abs(scatterXs[i] - expected[i])).toBeLessThanOrEqual(1)
    }
  })
})

/**
 * The axis fits the data, not the window that was asked for.
 *
 * The domain ran to `Date.now()` whatever the newest quote was, so on a book
 * whose last quote is weeks old the plot ended in mid-air with a third of the
 * canvas blank - which reads as a collapse in supply rather than as the end of
 * the records. This is the arithmetic behind the fix, held separately from the
 * component so it stays true if the chart is rebuilt again.
 */
function axisExtent(rows: { t: number }[], start: number, end: number) {
  return {
    from: rows.length ? Math.max(start, rows[0].t) : start,
    to: rows.length ? Math.min(end, rows[rows.length - 1].t) : end,
  }
}

describe('price chart x-domain', () => {
  const day = 86_400_000
  const start = Date.parse('2026-03-01')
  const end = Date.parse('2026-08-28')

  it('stops at the last record rather than at today', () => {
    const last = Date.parse('2026-07-19')
    const rows = [{ t: Date.parse('2026-03-05') }, { t: last }]
    expect(axisExtent(rows, start, end).to).toBe(last)
  })

  it('starts at the first record inside the window, not the window edge', () => {
    const first = Date.parse('2026-05-01')
    const rows = [{ t: first }, { t: Date.parse('2026-06-01') }]
    expect(axisExtent(rows, start, end).from).toBe(first)
  })

  it('never widens past the window it was given', () => {
    // A record either side of the window must not drag the axis out to meet it.
    const rows = [{ t: start - 40 * day }, { t: end + 40 * day }]
    const { from, to } = axisExtent(rows, start, end)
    expect(from).toBe(start)
    expect(to).toBe(end)
  })

  it('falls back to the window when there is nothing to plot', () => {
    expect(axisExtent([], start, end)).toEqual({ from: start, to: end })
  })
})

/**
 * The palette is shared by three components - the price chart's lines, the pie's
 * slices, and the supplier list's dots - all through supplierColor. These pin
 * the properties that made the palette valid, so a later edit that reaches for a
 * nicer-looking hex has to break a test rather than break colourblind readers.
 */
describe('supplier palette', () => {
  it('gives one supplier the same colour in every chart that draws it', () => {
    const suppliers = ['a', 'b', 'c', 'd'].map((id) => ({ id })) as never
    const first = supplierColor('c', suppliers)
    expect(supplierColor('c', suppliers)).toBe(first)
    expect(supplierColor('a', suppliers)).not.toBe(first)
  })

  it('gives the four seeded suppliers four different colours', () => {
    const suppliers = ['a', 'b', 'c', 'd'].map((id) => ({ id })) as never
    const used = ['a', 'b', 'c', 'd'].map((id) => supplierColor(id, suppliers))
    expect(new Set(used).size).toBe(4)
  })

  it('falls back to a real colour for a supplier missing from the list', () => {
    expect(supplierColor('ghost', [] as never)).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('keeps amber and red out of the series, since they mean status here', () => {
    // A supplier tinted amber would read as "watch"; one tinted red as "act now".
    for (const hex of SERIES) {
      const r = parseInt(hex.slice(1, 3), 16)
      const g = parseInt(hex.slice(3, 5), 16)
      const b = parseInt(hex.slice(5, 7), 16)
      expect(r > g && g > b && r > 150).toBe(false)
    }
  })
})
