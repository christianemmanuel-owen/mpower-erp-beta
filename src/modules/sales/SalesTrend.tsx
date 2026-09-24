import { useEffect, useState } from 'react'
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Card, InfoTip, filterCls } from '../../components/ui'
import { fmtCurrency, fmtLiters } from '../../lib/format'
import { salesTrend, trendGrainFor, type DateRange, type TrendGrain, type TrendPoint } from '../../lib/metrics'
import { TEAL, TEAL_SOFT, TICK, CURSOR } from '../../lib/chartColors'
import type { Sale } from '../../data/types'

/**
 * Net sales over the selected range, one bar per day, week, month or quarter.
 *
 * The client asked to compare day against day over a week, week against
 * week over a month, and month or quarter over longer spans. The grain picks
 * itself from the range and can be overridden; the tooltip says how each bar
 * compares with the one before it, which is the comparison the bars invite.
 */
const GRAINS: { key: TrendGrain; label: string }[] = [
  { key: 'day', label: 'Daily' },
  { key: 'week', label: 'Weekly' },
  { key: 'month', label: 'Monthly' },
  { key: 'quarter', label: 'Quarterly' },
]
type Measure = 'revenue' | 'liters'

export default function SalesTrend({ sales, range }: { sales: Sale[]; range: DateRange }) {
  const auto = trendGrainFor(range)
  // Auto follows the range until the user picks a grain; a new range resets to auto.
  const [grain, setGrain] = useState<TrendGrain | 'auto'>('auto')
  const [measure, setMeasure] = useState<Measure>('revenue')
  useEffect(() => { setGrain('auto') }, [range.from, range.to])
  const g = grain === 'auto' ? auto : grain
  const series = salesTrend(sales, range, g)
  const total = series.reduce((s, p) => s + p[measure], 0)
  const busiest = series.reduce<TrendPoint | null>((best, p) => (p[measure] > (best?.[measure] ?? 0) ? p : best), null)
  // In full: the client reads these as money, and ₱27.58M hides the difference
  // between ₱27,575,120 and ₱27,584,000.
  const fmtV = (v: number) => (measure === 'revenue' ? fmtCurrency(v) : fmtLiters(v))
  // Every bar labelled up to ~16 bars; beyond that, every nth so labels don't collide.
  const every = Math.max(1, Math.ceil(series.length / 16))

  return (
    <Card className="flex min-h-[260px] flex-col" delay={100}>
      <div className="flex flex-wrap items-center gap-[10px] border-b border-linesoft bg-paper px-[14px] py-[8px]">
        <span className="inline-flex items-center gap-[5px] text-[13px] font-semibold">
          Sales over time
          <InfoTip label="Sales over time">
            Net sales per {g}, on the sale date. Confirmed orders count from the day
            the client&rsquo;s PO is in, whether or not the fuel has left the depot yet;
            returns are netted off in full. Hover a bar to compare it with the one before.
          </InfoTip>
        </span>
        <span className="font-meta text-[12px] text-faint">{fmtV(total)} in {series.length} {series.length === 1 ? g : `${g}s`}</span>
        <span className="ml-auto flex items-center gap-[6px]">
          <select aria-label="Measure" value={measure} onChange={(e) => setMeasure(e.target.value as Measure)} className={`${filterCls} h-[26px] w-auto min-w-0 py-0 text-[12px]`}>
            <option value="revenue">Net sales (₱)</option>
            <option value="liters">Volume (L)</option>
          </select>
          <select aria-label="Grain" value={grain} onChange={(e) => setGrain(e.target.value as TrendGrain | 'auto')} className={`${filterCls} h-[26px] w-auto min-w-0 py-0 text-[12px]`}>
            <option value="auto">Auto ({GRAINS.find((x) => x.key === auto)?.label.toLowerCase()})</option>
            {GRAINS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
          </select>
        </span>
      </div>
      <div className="min-h-0 flex-1 px-[8px] pt-[10px] pb-[4px]">
        {total === 0 ? (
          <p className="m-0 py-10 text-center text-[13px] text-faint">No sales in this range.</p>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={series} margin={{ top: 6, right: 6, bottom: 0, left: 6 }} barCategoryGap={series.length > 20 ? '20%' : '32%'}>
              <XAxis
                dataKey="label" tickLine={false} axisLine={false} interval={every - 1}
                tick={{ fontSize: 11, fill: TICK }}
              />
              <YAxis hide domain={[0, (max: number) => Math.max(max, 1)]} />
              <Tooltip content={<TrendTip series={series} measure={measure} grain={g} />} cursor={{ fill: CURSOR, opacity: 0.35 }} />
              <Bar dataKey={measure} isAnimationActive={false} radius={[4, 4, 0, 0]}>
                {series.map((p) => (
                  <Cell key={p.from} fill={busiest && p.from === busiest.from ? TEAL : TEAL_SOFT} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  )
}

function TrendTip({ active, payload, series, measure, grain }: {
  active?: boolean
  payload?: { payload: TrendPoint }[]
  series: TrendPoint[]
  measure: Measure
  grain: TrendGrain
}) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  const i = series.findIndex((x) => x.from === p.from)
  const prev = i > 0 ? series[i - 1] : null
  const delta = prev && prev[measure] > 0 ? ((p[measure] - prev[measure]) / prev[measure]) * 100 : null
  return (
    <div className="tnum rounded-[8px] border border-line bg-white px-3 py-2 font-meta text-[12px] shadow-[0_4px_14px_rgba(20,24,27,.10)]">
      <p className="m-0 font-semibold text-mut">{p.label}</p>
      <p className="m-0 font-semibold">{fmtCurrency(p.revenue)} · {fmtLiters(p.liters)}</p>
      {prev && (
        <p className={`m-0 mt-[2px] ${delta === null ? 'text-faint' : delta >= 0 ? 'text-teal' : 'text-redtext'}`}>
          {delta === null ? `nothing the ${grain} before` : `${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta).toFixed(0)}% vs the ${grain} before`}
        </p>
      )}
    </div>
  )
}
