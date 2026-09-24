import { ModuleLink } from '../../components/ModuleLink'
import { TEAL, TEAL_BRIGHT, TEAL_SOFT, GRID, AXIS, TICK, CURSOR } from '../../lib/chartColors'
import { useEffect, useState, type ReactNode } from 'react'
import { ArrowUpDown } from 'lucide-react'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { useTables } from '../../lib/data'
import {
  agentStats, daysOfCoverTrailing, flowSeries, inRange, netSaleVolume, recentActivity,
  revenue, stockByWarehouse, stockSeries, volumeIn, volumeOut,
  type ActivityEvent, type DateRange, type FlowPoint, type StockSeriesPoint,
} from '../../lib/metrics'
import { RangePicker, rangeDays, useRange } from '../../lib/range'
import { canAccess, useAuth } from '../../lib/auth'
import {
  DASHBOARD_TABS, WIDGET_LABELS, WIDGET_TAB, orderWidgets, reorderWithinGroup, resolveWidgets, type DashboardTab,
} from '../../lib/dashboardConfig'
import { repos } from '../../data/repo'
import AnnouncementsCard from './AnnouncementsCard'
import { PendingBanner } from '../settings/Approvals'
import { todayISO, fmtCurrency, fmtLiters, label } from '../../lib/format'
import { InfoTip, Card, Gauge, GhostButton, KpiStrip, PageHeader, PrimaryButton, SectionLabel, PageSkeleton } from '../../components/ui'
import NeedsAttentionCard from './NeedsAttention'
import { IncomingCard, MovementsCard } from './OperationsCards'
import { ReceivablesCard, ToCollectCard, TopAgentsCard } from './CashFlowCards'
import ActivityCard from './ActivityCard'
import type {
  DashboardWidget, Delivery, Purchase, Sale, StockThreshold, Warehouse,
} from '../../data/types'

/** Shared with the small dot legend under the stock trend chart. */
/** Small multiples carry the depot names themselves, so the series no longer
 * need to be told apart by hue. One neutral for every line. */
const SPARK_LINE = '#5f6971'
const SPARK_DOT = '#14181b'

/** Compact liters with no space before the unit - recharts wraps axis tick text on
 * whitespace when it doesn't fit the axis width, splitting "300k L" onto two lines. */
function fmtAxisLiters(v: number) {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (Math.abs(v) >= 1_000) return `${Math.round(v / 1_000)}k`
  return `${Math.round(v)}`
}

function fmtAgo(t: number) {
  const mins = Math.max(0, Math.round((Date.now() - t) / 60_000))
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

function prevRange(range: DateRange): DateRange {
  const from = Date.parse(range.from)
  const to = Date.parse(range.to)
  const len = to - from + 86_400_000
  return { from: new Date(from - len).toISOString(), to: new Date(from - 86_400_000).toISOString() }
}

/**
 * The ETA Logistics staff entered, as a short "in 40m" / "25m late" phrase.
 *
 * This used to be `etaMinutes(id)` - a hash of the delivery id producing a
 * stable number between 8 and 52 that was rendered as a real ETA. It looked
 * entirely convincing and was invented. Exhibit A 1.1 specifies an ETA "entered
 * and maintained by Logistics staff", which is `Delivery.etaAt`; the automatic
 * one from live vehicle position is a Dependent Item on 2.8.
 *
 * Returns null when no ETA has been set, and the caller says so. A blank is
 * honest; a guess is what someone rings a customer with.
 */
function etaLabel(d: Delivery, now: number): string | null {
  if (!d.etaAt) return null
  const mins = Math.round((Date.parse(d.etaAt) - now) / 60_000)
  if (!Number.isFinite(mins)) return null
  if (mins >= 0) return mins < 60 ? `ETA ${mins}m` : `ETA ${Math.floor(mins / 60)}h ${mins % 60}m`
  const late = Math.abs(mins)
  return late < 60 ? `${late}m overdue` : `${Math.floor(late / 60)}h ${late % 60}m overdue`
}

/** The "and percentage" half of Exhibit A 1.1's headline numbers. Renders
 * nothing when there is no prior period to compare against - an absent
 * comparison is honest, whereas "0%" claims the figure held steady. */
function Movement({ pct, inline = false, days }: { pct: number | null; inline?: boolean; days?: number }) {
  if (pct === null) return inline ? null : <span>no prior period</span>
  const up = pct >= 0
  return (
    <span className={`${inline ? 'ml-2 ' : ''}font-semibold text-lab`}>
      <span className="align-[1px] text-[10px] text-faint">{up ? '▲' : '▼'}</span> {Math.abs(pct).toFixed(1)}%
      {/* Said on the figure, not only in the header tip: "vs prior 7 days" is
          the part a reader has to know to read the arrow at all. */}
      {days !== undefined && !inline && (
        <span className="font-normal text-mut"> vs prior {days === 1 ? 'day' : `${days} days`}</span>
      )}
    </span>
  )
}

interface VolumePoint {
  t: number
  volume: number
}

/** Buckets sold volume into up to 16 points spanning the range, spaced by timestamp
 * so the recharts x-axis lines up with real dates instead of arbitrary pixel columns. */
function volumeSeries(sales: Sale[], range: DateRange): VolumePoint[] {
  const from = Date.parse(range.from.slice(0, 10))
  const to = Date.parse(range.to.slice(0, 10))
  const days = Math.max(1, Math.round((to - from) / 86_400_000) + 1)
  const buckets = Math.min(days, 16)
  const per = days / buckets
  const totals = new Array(buckets).fill(0)
  for (const s of sales) {
    if (!inRange(s.date, range)) continue
    const day = Math.round((Date.parse(s.date.slice(0, 10)) - from) / 86_400_000)
    // netSaleVolume, not volumeLiters. This chart used to count a cancelled or
    // returned sale at its full volume while the KPI band, the stock figures
    // and Bought vs sold all netted them out - so two charts on one page
    // disagreed about how much was sold.
    totals[Math.min(Math.floor(day / per), buckets - 1)] += netSaleVolume(s)
  }
  return totals.map((volume, i) => ({
    t: Math.round(from + (i / (buckets - 1 || 1)) * (to - from)),
    volume,
  }))
}

function VolumeTip({ active, payload }: { active?: boolean; payload?: { payload: VolumePoint }[] }) {
  if (!active || !payload?.length) return null
  const { t, volume } = payload[0].payload
  return (
    <div className="tnum rounded-[8px] border border-line bg-white px-3 py-2 font-meta text-[12px] shadow-[0_4px_14px_rgba(20,24,27,.10)]">
      <p className="m-0 font-semibold text-mut">{new Date(t).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}</p>
      <p className="m-0 font-semibold">{fmtLiters(volume)}</p>
    </div>
  )
}

/** Daily-volume area chart - recharts, matching the teal styling used on the Accounts price chart. */
function VolumeChart({ series, from, to }: { series: VolumePoint[]; from: number; to: number }) {
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(from + f * (to - from)))
  const fmtTick = (t: number) => new Date(t).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={series} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
        <defs>
          <linearGradient id="dashVolumeFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={TEAL_BRIGHT} stopOpacity={0.32} />
            <stop offset="100%" stopColor={TEAL_BRIGHT} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <XAxis
          type="number" dataKey="t" domain={[from, to]} ticks={ticks}
          tickFormatter={fmtTick} tickLine={false} axisLine={false}
          tick={{ fontSize: 11, fill: TICK }}
        />
        <YAxis hide domain={[0, (max: number) => Math.max(max, 1)]} />
        <Tooltip content={<VolumeTip />} cursor={{ stroke: CURSOR, strokeDasharray: '4 3' }} />
        <Area
          type="linear" dataKey="volume" isAnimationActive={false}
          stroke={TEAL} strokeWidth={2.5} fill="url(#dashVolumeFill)"
          dot={(props: { cx?: number; cy?: number; index?: number }) => {
            const { cx, cy, index } = props
            if (index !== series.length - 1 || cx === undefined || cy === undefined) return <g key={index} />
            return <circle key={index} cx={cx} cy={cy} r={4} fill={TEAL} />
          }}
          activeDot={{ r: 4 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

function FlowTip({ active, payload, label: t }: { active?: boolean; payload?: { dataKey?: string; value?: number }[]; label?: number }) {
  if (!active || !payload?.length || t === undefined) return null
  const bought = payload.find((p) => p.dataKey === 'bought')?.value ?? 0
  const sold = payload.find((p) => p.dataKey === 'sold')?.value ?? 0
  return (
    <div className="tnum rounded-[8px] border border-line bg-white px-3 py-2 font-meta text-[12px] shadow-[0_4px_14px_rgba(20,24,27,.10)]">
      <p className="m-0 mb-1 font-semibold text-mut">{new Date(t).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}</p>
      <p className="m-0 flex items-center gap-[6px] font-semibold">
        <span className="h-[8px] w-[8px] shrink-0 rounded-full" style={{ background: TEAL }} />
        Bought: {fmtLiters(bought)}
      </p>
      <p className="m-0 flex items-center gap-[6px] font-semibold">
        <span className="h-[8px] w-[8px] shrink-0 rounded-full" style={{ background: TEAL_SOFT }} />
        Sold: {fmtLiters(sold)}
      </p>
    </div>
  )
}

/** Bought vs sold volume per day - shows at a glance whether depots are building up or draining. */

/**
 * Per-depot stock level over time, as small multiples - one sparkline each.
 *
 * This was a single LineChart with one coloured line per depot. Four lines
 * overlapping was the busiest object on the dashboard and it needed a legend
 * to decode; four separate lines in one neutral read faster, carry their own
 * labels and current value, and need no legend at all.
 */
function FlowChart({ series, from, to }: { series: FlowPoint[]; from: number; to: number }) {
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(from + f * (to - from)))
  const fmtTick = (t: number) => new Date(t).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis
          type="number" dataKey="t" domain={[from, to]} ticks={ticks}
          tickFormatter={fmtTick} tickLine={false} axisLine={{ stroke: AXIS }}
          tick={{ fontSize: 10.5, fill: TICK }}
          padding={{ left: 20, right: 20 }}
        />
        <YAxis
          type="number" tickFormatter={fmtAxisLiters} tickLine={false} axisLine={false}
          tick={{ fontSize: 10.5, fill: TICK }} width={40} tickMargin={6}
        />
        <Tooltip content={<FlowTip />} cursor={{ fill: 'rgba(20,24,27,.03)' }} />
        <Bar dataKey="bought" fill={TEAL} radius={[3, 3, 0, 0]} isAnimationActive={false} maxBarSize={18} />
        <Bar dataKey="sold" fill={TEAL_SOFT} radius={[3, 3, 0, 0]} isAnimationActive={false} maxBarSize={18} />
      </BarChart>
    </ResponsiveContainer>
  )
}

/**
 * Depots - the merge of three cards that were asking one question.
 *
 * Depot fill drew a gauge per depot with percent of capacity. Stock levels drew
 * a sparkline per depot with the current liters. Low stock listed the depots
 * under their warning level. Same depots, same current figure, three cards, and
 * on two different tabs.
 *
 * One row now carries all of it: how full, how much, which way it is heading,
 * and either how long it lasts or how far under it is. Days of cover is the
 * useful right-hand value, because "82%" does not tell a dispatcher whether to
 * order - 6 days of cover does.
 */
function DepotsCard({ warehouses, stock, series, purchases, sales, thresholds }: {
  warehouses: Warehouse[]
  stock: Map<string, number>
  series: StockSeriesPoint[]
  purchases: Purchase[]
  sales: Sale[]
  thresholds: StockThreshold[]
}) {
  return (
    <Card className="flex flex-col">
      <div className="flex items-center gap-[10px] border-b border-linesoft bg-paper px-[14px] py-[10px]">
        <span className="text-[13px] font-semibold">Depots</span>
        <ModuleLink to="/inventory" className="ml-auto" />
      </div>
      {warehouses.map((w) => {
        const onHand = Math.max(stock.get(w.id) ?? 0, 0)
        const pct = w.capacityLiters > 0 ? Math.round((onHand / w.capacityLiters) * 100) : 0
        const threshold = thresholds.find((t) => t.warehouseId === w.id && t.active !== false)
        const short = threshold ? threshold.thresholdLiters - onHand : 0
        const below = short > 0
        const cover = daysOfCoverTrailing(purchases, sales, w.id).days
        const values = series.map((pt) => pt.values[w.id] ?? 0)
        return (
          <div key={w.id} className="flex items-center gap-[10px] border-b border-linesoft px-[14px] py-[11px] last:border-0">
            <span className="w-[104px] shrink-0">
              <span className="block truncate text-[13px] font-semibold">{w.name.replace(' depot', '')}</span>
              <span className="block font-meta text-[12px] text-faint">
                {fmtLiters(w.capacityLiters)} capacity
              </span>
            </span>
            <span className="min-w-0 flex-1">
              <span className="mb-[5px] flex justify-between font-meta text-[12px]">
                <span className="tnum text-sec">{fmtLiters(onHand)}</span>
                <span className="tnum text-mut">{pct}%</span>
              </span>
              {/* One hue, one meaning. This was red / amber / teal by level, which
                  read as a colour per depot rather than a severity: the amber
                  fired at 85% of capacity, i.e. on a tank that is nearly FULL,
                  spending the watch-colour on good news. Grey is the normal
                  state at every level; red means the depot is under its warning
                  level and someone has to order. */}
              <Gauge pct={pct} color={below ? 'bg-redf' : 'bg-mut'} />
            </span>
            <span className="shrink-0">
              <DepotSpark values={values} name={w.name} />
            </span>
            <span className="w-[104px] shrink-0 text-right font-meta text-[12px] font-semibold">
              {below ? (
                <span className="tnum text-redtext">{fmtLiters(short)} short</span>
              ) : cover !== null ? (
                <span className="tnum text-mut">{Math.round(cover)} days cover</span>
              ) : (
                // No outflow in the period, so there is no rate to divide by.
                // Saying "unlimited" would be a lie about a quiet month.
                <span className="text-faint">no outflow</span>
              )}
            </span>
          </div>
        )
      })}
      {warehouses.length === 0 && (
        <p className="m-0 px-[14px] py-6 text-center text-[13px] text-faint">No depots recorded yet.</p>
      )}
      {/* Counting rows rather than active ones hid this: a warehouse whose only
          threshold is switched off can never be marked short, and the hint
          explaining why stayed hidden because a row did exist. */}
      {thresholds.filter((t) => t.active !== false).length === 0 && warehouses.length > 0 && (
        <p className="m-0 border-t border-linesoft px-[14px] py-[8px] font-meta text-[12px] text-faint">
          No active warning level, so nothing here can report being short. Set one in Stock.
        </p>
      )}
    </Card>
  )
}

/** One depot's stock over the period. Neutral, because the depot name is
 * already beside it and a hue would encode nothing. */
function DepotSpark({ values, name }: { values: number[]; name: string }) {
  const max = Math.max(...values, 0)
  const min = Math.min(...values, 0)
  const span = max - min
  const pts = values.map((v, i) => {
    const x = values.length > 1 ? (i / (values.length - 1)) * 88 : 0
    // A depot that held steady has no range to scale against. Draw it down the
    // middle rather than pinning a flat line to the floor, which reads as empty.
    const y = span === 0 ? 13 : 24 - ((v - min) / span) * 20
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  const [lx, ly] = (pts[pts.length - 1] ?? '88,13').split(',')
  return (
    <svg viewBox="0 0 92 26" preserveAspectRatio="none" className="block h-[26px] w-[92px]" role="img" aria-label={`${name} stock trend`}>
      <polyline
        fill="none" stroke={SPARK_LINE} strokeWidth={1.3} strokeLinejoin="round" strokeLinecap="round"
        vectorEffect="non-scaling-stroke" points={pts.join(' ')}
      />
      {/* The dot was red on a short depot, which made the gauge, this dot and
          the "N L short" text three red marks for one fact. The text and the
          gauge are the pair that carries it; this stays neutral. */}
      <circle cx={lx} cy={ly} r={2.1} fill={SPARK_DOT} />
    </svg>
  )
}

export default function Dashboard() {
  const { range } = useRange()
  // Hooks must run before the `!data` early return below, or React sees a
  // different hook count once the query resolves.
  const { seat } = useAuth()
  const data = useTables(['purchases', 'sales', 'warehouses', 'agents', 'deliveries', 'customers', 'trucks', 'personnel', 'suppliers', 'dashboardConfigs', 'dashboardLayouts', 'stockThresholds', 'products'] as const)
  // Draft order while the user is rearranging. null = not arranging.
  const [arranging, setArranging] = useState<DashboardWidget[] | null>(null)
  const [tab, setTab] = useState<'Overview' | 'Operations' | 'Cash flow' | 'Activity'>('Overview')
  /** Whether the announcement compose dock is expanded. The dock's own
   * collapsed bar is the only way in now - the top bar's New post button is
   * gone, so the quick-create route for 'announcement' went with it. */
  const [composingPost, setComposingPost] = useState(false)
  const [saving, setSaving] = useState(false)
  // Leaving the page mid-arrange should discard the draft, not persist it.
  useEffect(() => () => setArranging(null), [])
  if (!data) return <PageSkeleton />
  const { purchases, sales, warehouses, agents, deliveries, customers, trucks, personnel, suppliers, stockThresholds, products } = data

  const today = todayISO()
  const seatName = seat?.name ?? 'there'

  // Each card only renders for seats with access to the module its data comes from.
  const hasSales = canAccess(seat, 'sales')
  const hasStock = canAccess(seat, 'inventory')
  const hasTrips = canAccess(seat, 'logistics')
  const hasFlow = hasSales && hasStock // bought-vs-sold mixes purchases and sales

  // Exhibit A 1.1 - per-role dashboard configuration. This NARROWS what the
  // module gates above already allow; it never widens it. resolveWidgets applies
  // the same module check itself, so a config that names a widget the seat has
  // no access to is dropped there rather than trusted here.
  const allowed = resolveWidgets(seat, data.dashboardConfigs)
  const myLayout = data.dashboardLayouts.find((l) => l.seatId === seat?.id)
  // `arranging` holds the draft order while the user is rearranging, so a
  // half-finished rearrangement is never written to the server.
  const widgets = arranging ?? orderWidgets(allowed, myLayout?.widgets)
  // One clock reading for the whole render, so two ETAs on the same screen can't
  // disagree by a minute mid-paint.
  const nowMs = Date.now()

  const stock = stockByWarehouse(purchases, sales)
  const totalStock = [...stock.values()].reduce((a, b) => a + b, 0)
  const sold = volumeOut(sales, range)
  const rev = revenue(sales, range)

  // Exhibit A 1.1 asks for each headline number "showing both value and
  // percentage". The percentage is against the immediately preceding period of
  // the same length, so a fortnight compares to the fortnight before it.
  // pctDelta returns null rather than 0 when there is no prior figure - a "0%"
  // against a period with no trade reads as "flat", which is a different and
  // wrong claim.
  const prev = prevRange(range)
  const pctDelta = (current: number, previous: number) =>
    previous > 0 ? ((current - previous) / previous) * 100 : null

  const prevSold = volumeOut(sales, prev)
  const delta = pctDelta(sold, prevSold)
  const days = rangeDays(range)

  // Stock on hand is a level, not a flow: it is always what the depots hold
  // now, whatever range is picked. What the range can say about it is how it
  // moved - today's figure less the net of what came in and went out over the
  // range is what it stood at when the range began.
  const stockAtStart = totalStock - (volumeIn(purchases, range) - sold)
  const stockDelta = pctDelta(totalStock, stockAtStart)

  const inVol = volumeIn(purchases, range)
  const inDelta = pctDelta(inVol, volumeIn(purchases, prev))

  // "Deliveries scheduled and completed" - counted on the final schedule, which
  // is what Logistics committed to (see src/lib/logistics.ts).
  const scheduledInRange = deliveries.filter((d) => inRange(d.scheduleDate, range))
  const completedInRange = scheduledInRange.filter((d) => d.status === 'delivered')
  const prevScheduled = deliveries.filter((d) => inRange(d.scheduleDate, prev))
  const completionPct = scheduledInRange.length > 0
    ? (completedInRange.length / scheduledInRange.length) * 100
    : null
  const scheduledDelta = pctDelta(scheduledInRange.length, prevScheduled.length)



  const saleOf = (d: Delivery) => sales.find((s) => s.id === d.saleId)
  const customerOf = (d: Delivery) => customers.find((c) => c.id === saleOf(d)?.customerId)
  const stats = agentStats(agents, sales, range)
  const series = volumeSeries(sales, range)
  const from = Date.parse(range.from)
  const to = Date.parse(range.to)
  const stockSer = stockSeries(purchases, sales, warehouses.map((w) => w.id), range)
  const flow = flowSeries(purchases, sales, range)
  // Only feed in record types this seat can see, so no purchase/sale/trip lines leak through.
  const activity = recentActivity(hasStock ? purchases : [], hasSales ? sales : [], hasTrips ? deliveries : [], 8)

  function activityLine(e: ActivityEvent) {
    if (e.kind === 'purchase') {
      const p = purchases.find((x) => x.id === e.id)
      if (!p) return null
      const supplier = suppliers.find((s) => s.id === p.supplierId)
      return {
        text: `Bought ${fmtLiters(p.volumeLiters)} from ${supplier?.name ?? '—'}`,
        meta: `${fmtCurrency(p.volumeLiters * p.pricePerLiter).replace('.00', '')} · ${warehouses.find((w) => w.id === p.warehouseId)?.name.replace(' depot', '') ?? '—'}`,
        status: p.status,
      }
    }
    if (e.kind === 'sale') {
      const s = sales.find((x) => x.id === e.id)
      if (!s) return null
      const c = customers.find((x) => x.id === s.customerId)
      return {
        text: `Sold ${fmtLiters(s.volumeLiters)} to ${c?.company ?? '—'}`,
        meta: `${fmtCurrency(s.volumeLiters * s.pricePerLiter).replace('.00', '')} · ${label(s.paymentMode)}`,
        status: s.status,
      }
    }
    const d = deliveries.find((x) => x.id === e.id)
    if (!d) return null
    const s = saleOf(d)
    const c = customerOf(d)
    return {
      text: `Delivery to ${c?.company ?? '—'}${s ? ` · ${fmtLiters(s.volumeLiters)}` : ''}`,
      meta: d.deliveryAddress,
      status: d.status,
    }
  }

  /**
   * The widgets this role asked for, in the order it asked for them.
   *
   * `resolveWidgets` has always returned an ordered list - the Dashboard roles
   * screen even has ↑/↓ buttons that write that order - but this component used
   * to funnel it through `widgetShower`, which collapses the list to a Set, and
   * then rendered from a hardcoded JSX sequence. The configured order was
   * therefore built, saved, and silently thrown away.
   *
   * Each widget key now contributes one or more blocks to a six-column grid, and
   * the blocks are emitted in configuration order. A block declares how many
   * columns it wants and the grid flows them, so a role that puts `lowStock`
   * first genuinely sees it first.
   *
   * `todos` contributes nothing here: the to-do list moved to the collapsible
   * side rail, where its record deep links are useful from every screen rather
   * than only from Home. The key still decides whether that rail appears.
   */
  interface Block { key: string; width: 'half' | 'full'; node: ReactNode }

  const blocksFor: Partial<Record<DashboardWidget, () => Block[]>> = {
    kpis: () => [
      { key: 'kpi-band', width: 'full', node: (
          <KpiStrip
            delay={30}
            items={[
              ...(hasStock ? [{
                label: 'Stock on hand',
                tip: { label: 'Stock on hand', body: (<>
                    Fuel in all depots right now: everything received, less everything
                    sold. The date range does not change this number. The arrow shows
                    how much stock went up or down since the start of the range.
                </>) },
                value: fmtLiters(totalStock),
                to: '/inventory',
                sub: (
                  <span>
                    as of today, {warehouses.length} depot{warehouses.length === 1 ? '' : 's'}
                    {stockDelta !== null && (
                      <span className="ml-2 font-semibold text-lab">
                        <span className="align-[1px] text-[10px] text-faint">{stockDelta >= 0 ? '▲' : '▼'}</span>{' '}
                        {Math.abs(stockDelta).toFixed(1)}%<span className="font-normal text-mut"> over the range</span>
                      </span>
                    )}
                  </span>
                ),
              }] : []),
              ...(hasStock ? [{
                label: 'Volume in',
                tip: { label: 'Volume in', body: (<>
                    Litres received from suppliers in the selected range. Orders not yet
                    delivered are not counted. The arrow compares this figure with the same
                    figure for the {days === 1 ? 'day' : `${days} days`} before that.
                </>) },
                value: fmtLiters(inVol),
                to: '/inventory/purchases',
                sub: <Movement pct={inDelta} days={days} />,
              }] : []),
              ...(hasSales ? [{
                label: 'Volume sold',
                tip: { label: 'Volume sold', body: (<>
                    Litres sold to customers in the selected range. Drafts and cancelled
                    sales are not counted; returned fuel is taken off. The arrow compares this
                    figure with the same figure for the {days === 1 ? 'day' : `${days} days`} before that.
                </>) },
                value: fmtLiters(sold),
                to: '/sales',
                sub: <Movement pct={delta} days={days} />,
              }] : []),
              ...(hasTrips ? [{
                label: 'Deliveries',
                tip: { label: 'Deliveries', body: (<>
                    Delivered trips out of all trips scheduled in the selected range.
                    Trips still on the road, or that failed, count as scheduled but not
                    delivered. The arrow compares the number scheduled with the number
                    scheduled in the {days === 1 ? 'day' : `${days} days`} before that.
                </>) },
                value: `${completedInRange.length}/${scheduledInRange.length}`,
                to: '/logistics',
                sub: completionPct === null
                  ? <span>none scheduled</span>
                  : <span>{Math.round(completionPct)}% completed<Movement pct={scheduledDelta} inline /></span>,
              }] : []),
            ]}
          />
      ) },
    ],
    volumeSold: () => hasSales ? [{ key: 'volume', width: 'half' as const, node: (
          <Card className="flex flex-col" delay={50}>
            <div className="flex items-center gap-[10px] border-b border-linesoft bg-paper px-[14px] py-[10px]">
              <span className="text-[13px] font-semibold">Volume sold</span>
              <ModuleLink to="/sales" className="ml-auto" />
            </div>
            <div className="flex flex-1 flex-col p-[14px]">
            <div className="mb-[6px] flex justify-between">
              <div>
                <SectionLabel>Sold</SectionLabel>
                <p className="tnum m-0 mt-1 font-display text-[28px] font-semibold tracking-[-0.02em]">
                  {fmtLiters(sold)}{' '}
                  {delta !== null && (
                    <span className={`text-[14px] font-semibold ${delta >= 0 ? 'text-teal' : 'text-redtext'}`}>
                      {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}%
                    </span>
                  )}
                </p>
              </div>
              <div className="text-right">
                <SectionLabel>Revenue</SectionLabel>
                <p className="tnum m-0 mt-1 font-display text-[28px] font-semibold tracking-[-0.02em]">{fmtCurrency(rev)}</p>
              </div>
            </div>
            <div className="min-h-[150px] flex-1">
              <VolumeChart series={series} from={from} to={to} />
            </div>
          </div>
          </Card>
      ) }] : [],
    stockByWarehouse: () => hasStock ? [{ key: 'depots', width: 'half' as const, node: (
          <DepotsCard
            warehouses={warehouses} stock={stock} series={stockSer}
            purchases={purchases} sales={sales}
            thresholds={stockThresholds}
          />
    ) }] : [],
    boughtVsSold: () => hasFlow ? [{ key: 'bought-sold', width: 'full' as const, node: (
            <Card className="flex flex-col" delay={200}>
              <div className="flex items-center gap-[10px] border-b border-linesoft bg-paper px-[14px] py-[10px]">
                <span className="text-[13px] font-semibold">Bought vs sold</span>
                <ModuleLink to="/sales" className="ml-auto" />
              </div>
              <div className="flex flex-1 flex-col p-[14px]">
              <div className="min-h-[170px] flex-1">
                <FlowChart series={flow} from={from} to={to} />
              </div>
              <p className="m-0 mt-2 flex gap-3 font-meta text-[12px] text-faint">
                <span className="flex items-center gap-1"><span className="h-[8px] w-[8px] rounded-full" style={{ background: TEAL }} />Bought</span>
                <span className="flex items-center gap-1"><span className="h-[8px] w-[8px] rounded-full" style={{ background: TEAL_SOFT }} />Sold</span>
              </p>
            </div>
            </Card>
      ) }] : [],
    deliveryBoard: () => hasTrips ? [{ key: 'movements', width: 'full' as const, node: (
          <MovementsCard
            deliveries={deliveries} sales={sales} customers={customers}
            trucks={trucks} personnel={personnel}
            today={today} nowMs={nowMs} etaLabel={etaLabel}
          />
    ) }] : [],
    incoming: () => hasStock ? [{ key: 'incoming', width: 'half' as const, node: (
          <IncomingCard purchases={purchases} suppliers={suppliers} warehouses={warehouses} today={today} />
    ) }] : [],
    agentQuota: () => hasSales ? [
      { key: 'to-collect', width: 'half', node: <ToCollectCard sales={sales} today={today} /> },
      { key: 'top-agents', width: 'half', node: (
          <TopAgentsCard
            stats={stats}
          />
      ) },
    ] : [],
    receivables: () => hasSales ? [{ key: 'receivables', width: 'half' as const, node: (
          <ReceivablesCard sales={sales} customers={customers} personnel={personnel} today={today} />
    ) }] : [],
    needsAttention: () => [{ key: 'needs-attention', width: 'full' as const, node: (
          // Every collection is passed empty when the seat lacks that module,
          // so the block cannot show a peso figure to someone the access layer
          // has excluded. See attentionRows().
          <NeedsAttentionCard
            sales={hasSales ? sales : []}
            purchases={hasStock ? purchases : []}
            deliveries={hasTrips ? deliveries : []}
            customers={customers}
            personnel={personnel}
            warehouses={warehouses}
            products={products}
            stockThresholds={hasStock ? stockThresholds : []}
          />
    ) }],
    announcements: () => [{ key: 'announcements', width: 'half' as const, node: (
          <AnnouncementsCard
            delay={300}
            composing={composingPost}
            onCompose={() => setComposingPost(true)}
            onCloseCompose={() => setComposingPost(false)}
          />
    ) }],
    approvals: () => [{ key: 'approvals', width: 'full', node: (
      <>
          {/* Only ever the seat's own parked inputs - see PendingBanner. */}
          <PendingBanner tbl="sales" />
          <PendingBanner tbl="purchases" />
      </>
    ) }],
    recentTransactions: () => (hasSales || hasStock || hasTrips) ? [{ key: 'recent', width: 'full', node: (
          <ActivityCard activity={activity} lineFor={activityLine} fmtAgo={fmtAgo} />
    ) }] : [],
  }

  // Tab membership is shared with the per-role editor - see dashboardConfig.
  const TABS = DASHBOARD_TABS
  type Tab = DashboardTab

  // A tab with nothing in it for this seat is not shown at all, rather than
  // leading somewhere blank or advertising widgets the seat cannot see.
  const tabsWithContent = TABS.filter((t) =>
    widgets.some((w) => WIDGET_TAB[w] === t && (blocksFor[w]?.() ?? []).length > 0),
  )
  const activeTab: Tab = tabsWithContent.includes(tab) ? tab : (tabsWithContent[0] ?? 'Overview')
  const tabWidgets = widgets.filter((w) => WIDGET_TAB[w] === activeTab)

  const blocks = tabWidgets.flatMap((w) => blocksFor[w]?.() ?? [])

  /**
   * Pack the ordered blocks into rows of one or two.
   *
   * An earlier version flowed blocks into a six-column grid by column span,
   * which left large holes whenever a narrow block was followed by a wide one -
   * a two-column card sitting alone with four empty columns beside it. Pairing
   * adjacent halves, and letting a lone half run full width, means there is
   * never a hole. The configured order is still followed exactly: this decides
   * only how many blocks share a row, never which block comes first.
   */
  const rows: Block[][] = []
  for (let i = 0; i < blocks.length; i++) {
    const next = blocks[i + 1]
    if (blocks[i].width === 'half' && next?.width === 'half') {
      rows.push([blocks[i], next])
      i++
    } else {
      rows.push([blocks[i]])
    }
  }

  /**
   * Move a widget within the tab being arranged.
   *
   * The stored layout is one flat ordered list across every tab, so reordering
   * inside a tab has to write back into the slots that tab already occupies.
   * Doing it this way means rearranging Operations cannot disturb where the
   * Cash flow cards sit relative to Activity.
   */
  function moveWidget(from: number, to: number) {
    setArranging(reorderWithinGroup(widgets, (w) => WIDGET_TAB[w] === activeTab, from, to))
  }

  async function saveLayout() {
    if (!arranging || !seat) return
    setSaving(true)
    try {
      // Store only the order. `orderWidgets` re-filters it against the role
      // configuration on every read, so this can never grant anything.
      if (myLayout) await repos.dashboardLayouts.update(myLayout.id, { widgets: arranging })
      else await repos.dashboardLayouts.add({ seatId: seat.id, widgets: arranging })
      setArranging(null)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-[8px]">
            Welcome, {seatName}
            <InfoTip label="How to read the figures">
              ▲▼ arrows compare the selected range with the same number of days just
              before it. "No prior period" means there was nothing to compare with.
              Percentages without an arrow are shares of a whole, such as how full a
              depot is.
            </InfoTip>
          </span>
        }
        right={
          arranging ? (
            <span className="flex items-center gap-2">
              <span className="font-meta text-[12px] text-mut">Reordering {activeTab.toLowerCase()}</span>
              <GhostButton onClick={() => setArranging(null)}>Cancel</GhostButton>
              <PrimaryButton onClick={saveLayout}>{saving ? 'Saving…' : 'Done'}</PrimaryButton>
            </span>
          ) : (
            <span className="flex items-center gap-2">
              {/* Tabs sit in the header row rather than on their own line. As a
                  separate row the control stretched the full page width, which
                  made four short words look like a banner. */}
              {tabsWithContent.length > 1 && (
                <span className="flex gap-[2px] rounded-[6px] bg-fill2 p-[2px]">
                  {tabsWithContent.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTab(t)}
                      aria-current={t === activeTab ? 'page' : undefined}
                      className={`cursor-pointer rounded-[4px] border-0 px-[11px] py-[4px] font-meta text-[12px] transition-colors ${
                        t === activeTab
                          ? 'bg-white font-semibold text-ink shadow-[0_1px_2px_rgba(20,24,27,.05)]'
                          : 'bg-transparent text-mut hover:text-ink'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </span>
              )}
              {/* Arrange loses its label to make room. It is a rare action and
                  the icon carries it, with the name in the tooltip. */}
              <button
                type="button"
                onClick={() => setArranging(orderWidgets(allowed, myLayout?.widgets))}
                title="Arrange sections"
                aria-label="Arrange sections"
                className="flex h-[28px] w-[28px] cursor-pointer items-center justify-center rounded-[6px] border border-inputline bg-white text-mut transition-colors hover:bg-fill2 hover:text-ink"
              >
                <ArrowUpDown size={14} strokeWidth={1.8} />
              </button>
              <RangePicker />
            </span>
          )
        }
      />

      {/* Arranging works on whole widgets, not on the cards they render - a
          widget like `kpis` puts four cards on the screen and they move as one.
          So arrange mode is a plain numbered list of section names rather than
          the sections themselves: the whole order fits on screen at once. */}
      {arranging ? (
        <div className="overflow-hidden rounded-[8px] border border-line bg-white">
          {tabWidgets.map((w, i) => (
            <div key={w} className="flex items-center gap-3 border-b border-linesoft px-[14px] py-[9px] last:border-0">
              <span className="w-[14px] shrink-0 font-meta text-[12px] text-faint">{i + 1}</span>
              <span className="flex-1 truncate text-[13px]">{WIDGET_LABELS[w]}</span>
              <span className="flex shrink-0 gap-1">
                <button
                  type="button"
                  onClick={() => moveWidget(i, i - 1)}
                  disabled={i === 0}
                  aria-label={`Move ${WIDGET_LABELS[w]} up`}
                  className="cursor-pointer rounded-[4px] border border-inputline bg-white px-[8px] py-[1px] font-meta text-[12px] text-sec hover:bg-fill2 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => moveWidget(i, i + 1)}
                  disabled={i === tabWidgets.length - 1}
                  aria-label={`Move ${WIDGET_LABELS[w]} down`}
                  className="cursor-pointer rounded-[4px] border border-inputline bg-white px-[8px] py-[1px] font-meta text-[12px] text-sec hover:bg-fill2 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  ↓
                </button>
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((row) => (
            <div key={row[0].key} className={row.length === 2 ? 'grid grid-cols-2 items-stretch gap-3' : ''}>
              {/* Each cell is itself a grid so its single child stretches to the
                  row's height. Without this the *cell* stretched and the card
                  inside kept its natural height, leaving the row's shorter card
                  sitting above a gap. */}
              {row.map((b) => <div key={b.key} className="grid">{b.node}</div>)}
            </div>
          ))}
        </div>
      )}
    </>
  )
}
