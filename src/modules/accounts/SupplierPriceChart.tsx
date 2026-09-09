import { GRID, AXIS, TICK, CURSOR, supplierColor } from '../../lib/chartColors'
import { useMemo, useState } from 'react'
import {
  CartesianGrid, ComposedChart, Line, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis,
} from 'recharts'
import { Card, InfoTip, SectionLabel, filterCls } from '../../components/ui'
import { useRange } from '../../lib/range'
import { fmtDate } from '../../lib/format'
import type { Purchase, Supplier, SupplierQuote } from '../../data/types'



type Window = 'page' | '90' | '180' | '365'

const windowLabels: Record<Window, string> = {
  page: 'Match page filter',
  '90': 'Last 3 months',
  '180': 'Last 6 months',
  '365': 'Last 12 months',
}

/**
 * One row per date. Quotes live under `q_<supplierId>`, purchases under
 * `b_<supplierId>` with volume in `bv_<supplierId>` - so the tooltip can only
 * ever contain values that exist on the hovered date.
 */
interface Row {
  t: number
  [key: string]: number
}

function PurchaseDot(props: { cx?: number; cy?: number; fill?: string }) {
  const { cx, cy, fill } = props
  if (cx === undefined || cy === undefined || !Number.isFinite(cy)) return null
  return <circle cx={cx} cy={cy} r={4.5} fill={fill} stroke="#fff" strokeWidth={1.5} />
}

interface TipEntry {
  dataKey?: string | number
  value?: number | string
  color?: string
  payload?: Row
}

function makeTip(nameOf: (id: string) => string) {
  return function ChartTip({ active, payload, label }: { active?: boolean; payload?: TipEntry[]; label?: number }) {
    if (!active || !payload?.length || label === undefined) return null
    const row = payload[0]?.payload
    const lines: { color?: string; text: string; bold: boolean }[] = []
    const seen = new Set<string>()
    for (const p of payload) {
      const key = String(p.dataKey ?? '')
      if (seen.has(key) || typeof p.value !== 'number') continue
      seen.add(key)
      if (key.startsWith('q_')) {
        lines.push({ color: p.color, text: `${nameOf(key.slice(2))} quoted ₱${p.value.toFixed(2)}/L`, bold: false })
      } else if (key.startsWith('b_')) {
        const vol = row?.[`bv_${key.slice(2)}`]
        lines.push({
          color: p.color,
          text: `Bought from ${nameOf(key.slice(2))} - ${vol ? `${vol.toLocaleString()} L ` : ''}at ₱${p.value.toFixed(2)}/L`,
          bold: true,
        })
      }
    }
    if (lines.length === 0) return null
    return (
      <div className="tnum rounded-[10px] border border-line bg-white px-3 py-2 text-[12px] shadow-[0_4px_14px_rgba(20,28,40,.1)]">
        <p className="m-0 mb-1 font-semibold text-mut">{fmtDate(new Date(label).toISOString())}</p>
        {lines.map((l, i) => (
          <p key={i} className={`m-0 flex items-center gap-[6px] ${l.bold ? 'font-semibold' : ''}`}>
            <span className="h-[8px] w-[8px] shrink-0 rounded-full" style={{ background: l.color }} />
            {l.text}
          </p>
        ))}
      </div>
    )
  }
}

/** Quoted price per supplier over a selectable window; dots mark actual purchases. */
export default function SupplierPriceChart({ suppliers, quotes, purchases }: {
  suppliers: Supplier[]
  quotes: SupplierQuote[]
  purchases: Purchase[]
}) {
  const { range } = useRange()
  const [win, setWin] = useState<Window>('365')
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const toggle = (id: string) => setHidden((h) => {
    const next = new Set(h)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const { rows, start, end, yDomain, ticks, avgQuoted, avgPaid, empty } = useMemo(() => {
    const end = win === 'page' ? Date.parse(range.to) + 86_399_000 : Date.now()
    const start = win === 'page' ? Date.parse(range.from) : end - Number(win) * 86_400_000

    // Day-resolution rows so a purchase and a same-day quote share one row.
    const byDay = new Map<number, Row>()
    const rowFor = (iso: string) => {
      const t = new Date(iso.slice(0, 10)).getTime()
      let row = byDay.get(t)
      if (!row) {
        row = { t }
        byDay.set(t, row)
      }
      return row
    }

    const prices: number[] = []
    for (const q of quotes) {
      const t = Date.parse(q.date)
      if (t < start || t > end) continue
      rowFor(q.date)[`q_${q.supplierId}`] = q.pricePerLiter
      prices.push(q.pricePerLiter)
    }
    for (const p of purchases) {
      const t = Date.parse(p.date)
      if (t < start || t > end || p.status !== 'received') continue
      const row = rowFor(p.date)
      row[`b_${p.supplierId}`] = p.pricePerLiter
      row[`bv_${p.supplierId}`] = (row[`bv_${p.supplierId}`] ?? 0) + p.volumeLiters
      prices.push(p.pricePerLiter)
    }

    const rows = [...byDay.values()].sort((a, b) => a.t - b.t)

    // Fit the axis to the data, not to the window that was asked for. The
    // domain ran to "now" whatever the newest quote was, so on a book whose
    // last quote is six weeks old a third of the plot was blank canvas - the
    // lines stopped in mid-air and the eye read the gap as a collapse in
    // supply rather than as the end of the records.
    const from = rows.length ? Math.max(start, rows[0].t) : start
    const to = rows.length ? Math.min(end, rows[rows.length - 1].t) : end
    const yDomain: [number, number] = prices.length
      ? [Math.floor((Math.min(...prices) - 0.2) * 2) / 2, Math.ceil((Math.max(...prices) + 0.2) * 2) / 2]
      : [49, 56]

    const tickCount = 6
    const ticks: number[] = []
    for (let i = 0; i < tickCount; i++) ticks.push(Math.round(from + (i / (tickCount - 1)) * (to - from)))

    // The figures the chart exists to compare, stated before the plot rather
    // than left to be eyeballed off it. The gap between them is the whole
    // question: a supplier who quotes keenly and invoices otherwise shows up
    // here before anyone reads a line.
    const quoted = quotes.filter((q) => { const t = Date.parse(q.date); return t >= start && t <= end })
    const bought = purchases.filter((x) => {
      const t = Date.parse(x.date)
      return t >= start && t <= end && x.status === 'received'
    })
    const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
    const avgQuoted = mean(quoted.map((q) => q.pricePerLiter))
    const avgPaid = mean(bought.map((x) => x.pricePerLiter))

    return { rows, start: from, end: to, yDomain, ticks, avgQuoted, avgPaid, empty: rows.length === 0 }
  }, [quotes, purchases, win, range])

  const spanDays = (end - start) / 86_400_000
  const fmtTick = (t: number) =>
    new Date(t).toLocaleDateString('en-PH', spanDays > 240 ? { month: 'short' } : { month: 'short', day: 'numeric' })
  const nameOf = (id: string) => suppliers.find((s) => s.id === id)?.name.split(' ')[0] ?? '—'
  const Tip = useMemo(() => makeTip(nameOf), [suppliers]) // eslint-disable-line react-hooks/exhaustive-deps


  // The ruled header every other chart card in this app has. These two were the
  // only ones without it, which is why their title, figures, plot and legend all
  // ran together in one padded box with nothing separating chrome from data.
  return (
    <Card className="flex h-full flex-col" delay={100}>
      <div className="flex items-center justify-between gap-2 border-b border-linesoft px-[14px] py-[10px]">
        {/* The title used to end with the window - "· last 3 months" - which is
            the value of the selector immediately to its right. */}
        <span className="flex items-center gap-[6px]">
          <SectionLabel>Quoted against paid</SectionLabel>
          <InfoTip label="How to read this chart">
            A line is one supplier’s quoted price; a dot is a purchase at the price actually paid.
            Click a supplier below to hide its line, and hover any point for the detail.
          </InfoTip>
        </span>
        {/* No Record quote here. The page's primary action lives in the page
            header now (CREATE_ACTIONS in lib/quickCreate), and this card was
            still carrying its own copy - two identical black buttons a few
            pixels apart, one of them wired to a different handler. */}
        <select value={win} onChange={(e) => setWin(e.target.value as Window)} className={filterCls}>
          {(Object.keys(windowLabels) as Window[]).map((k) => (
            <option key={k} value={k}>{windowLabels[k]}</option>
          ))}
        </select>
      </div>
      <div className="flex flex-1 flex-col p-[14px]">
      <div className="mb-[14px] flex items-baseline gap-7">
        <span>
          <span className="block font-meta text-[10px] font-semibold uppercase tracking-[.09em] text-mut">Avg quoted</span>
          <span className="tnum block text-[20px] font-semibold leading-[1.2] tracking-[-0.02em]">
            {avgQuoted !== null ? `₱${avgQuoted.toFixed(2)}` : '—'}
          </span>
        </span>
        <span>
          <span className="block font-meta text-[10px] font-semibold uppercase tracking-[.09em] text-mut">Avg paid</span>
          <span className="tnum block text-[20px] font-semibold leading-[1.2] tracking-[-0.02em]">
            {avgPaid !== null ? `₱${avgPaid.toFixed(2)}` : '—'}
          </span>
        </span>
        {avgQuoted !== null && avgPaid !== null && (
          <span className="font-meta text-[12px] text-mut">
            {avgPaid <= avgQuoted ? 'paying under quote by ' : 'paying over quote by '}
            <span className={`tnum font-semibold ${avgPaid <= avgQuoted ? 'text-tealtext' : 'text-redtext'}`}>
              ₱{Math.abs(avgPaid - avgQuoted).toFixed(2)}/L
            </span>
          </span>
        )}
      </div>

      {empty ? (
        <p className="m-0 flex-1 py-14 text-center text-[13px] text-faint">No quotes or purchases in this window.</p>
      ) : (
        <div className="min-h-[240px] flex-1">
          <ResponsiveContainer width="100%" height="100%" minHeight={240}>
            <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
              <CartesianGrid vertical={false} stroke={GRID} />
              <XAxis
                type="number" dataKey="t" domain={[start, end]} ticks={ticks}
                tickFormatter={fmtTick} tickLine={false} axisLine={{ stroke: AXIS }}
                tick={{ fontSize: 10.5, fill: TICK }}
              />
              <YAxis
                type="number" domain={yDomain} tickCount={5}
                tickFormatter={(v: number) => `₱${v.toFixed(1)}`} tickLine={false} axisLine={false}
                tick={{ fontSize: 10.5, fill: TICK }} width={52}
              />
              <Tooltip content={<Tip />} cursor={{ stroke: CURSOR, strokeWidth: 1.5 }} />
              {suppliers.filter((s) => !hidden.has(s.id)).map((s) => (
                <Line
                  key={`q_${s.id}`} dataKey={`q_${s.id}`}
                  stroke={supplierColor(s.id, suppliers)} strokeWidth={2}
                  dot={false} activeDot={false} connectNulls isAnimationActive={false}
                />
              ))}
              {suppliers.filter((s) => !hidden.has(s.id)).map((s) => (
                <Scatter
                  key={`b_${s.id}`} dataKey={`b_${s.id}`}
                  fill={supplierColor(s.id, suppliers)}
                  shape={<PurchaseDot />} isAnimationActive={false}
                />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
      {/* Under the plot, where a legend belongs when the header already holds
          a filter and an action. The mark key is kept apart from the series
          names by a rule: "bought" is not a fifth supplier, and it sat in the
          same row as four that are. */}
      <div className="mt-[14px] flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-linesoft pt-[12px] font-meta text-[12px]">
        {suppliers.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => toggle(s.id)}
            aria-pressed={!hidden.has(s.id)}
            className={`flex cursor-pointer items-center gap-[6px] border-0 bg-transparent p-0 transition-opacity ${
              hidden.has(s.id) ? 'opacity-40' : ''
            }`}
            title={hidden.has(s.id) ? `Show ${s.name}` : `Hide ${s.name}`}
          >
            <span className="h-[3px] w-[14px] rounded-full" style={{ background: supplierColor(s.id, suppliers) }} />
            <span className="text-lab">{s.name.split(' ')[0]}</span>
          </button>
        ))}
        <span className="ml-auto flex items-center gap-[6px] text-mut">
          <span className="h-[8px] w-[8px] rounded-full border border-inputline bg-white" />
          a purchase, at the price paid
        </span>
      </div>
      </div>
    </Card>
  )
}
