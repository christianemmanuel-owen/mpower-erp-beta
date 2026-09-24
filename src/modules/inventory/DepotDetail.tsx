import { useMemo, useState } from 'react'
import { useOpenRecord } from '../../lib/peek'
import { Area, AreaChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Dialog, FormSection, Input, InfoTip, Pager, WIDE_DIALOG, td } from '../../components/ui'
import { FormNav, useSectionNav, type FormNavSection } from '../../components/FormNav'
import { RailAside, RailRow, RailSection } from '../../components/SummaryRail'
import { GoArrow } from '../../components/ModuleLink'
import { CURSOR, TEAL, TEAL_BRIGHT, TICK, supplierColor } from '../../lib/chartColors'
import { recordHref } from '../../lib/deepLink'
import { fmtCurrency, fmtDate, fmtLiters, fmtNum, todayISO } from '../../lib/format'
import {
  daysOfCoverTrailing, depotLedger, stockMovements, stockSeries, utilization, warehouseFlow, type DateRange,
} from '../../lib/metrics'
import type { Customer, Purchase, Sale, Supplier, Warehouse } from '../../data/types'

/**
 * One depot, opened from its row on the Stock page: everything that happened
 * to it, and what is in it now and where that came from.
 *
 * The depot table answers "how are the depots doing" a column at a time; the
 * client's ask was the other way round - press one depot and see all of its
 * activity. Same dialog shape as the forms: the figures in the rail, the
 * sections down the body, the nav to jump between them.
 */
export default function DepotDetail({ depot, purchases, sales, suppliers, customers, range, onClose }: {
  depot: Warehouse
  purchases: Purchase[]
  sales: Sale[]
  suppliers: Supplier[]
  customers: Customer[]
  range: DateRange
  onClose: () => void
}) {
  const today = todayISO()
  /** The Sources section can be read as of any day; the rest is now. */
  const [asOf, setAsOf] = useState(today)

  const now = useMemo(() => depotLedger(purchases, sales, depot.id), [purchases, sales, depot.id])
  const then = useMemo(() => (asOf === today ? now : depotLedger(purchases, sales, depot.id, asOf)), [purchases, sales, depot.id, asOf, today, now])
  const cover = useMemo(() => daysOfCoverTrailing(purchases, sales, depot.id), [purchases, sales, depot.id])
  const flow = warehouseFlow(purchases, sales, depot.id, range)
  const series = useMemo(() => stockSeries(purchases, sales, [depot.id], range, 40), [purchases, sales, depot.id, range])
  const util = utilization(series, depot.id, depot.capacityLiters)
  const moves = useMemo(
    () => stockMovements(purchases, sales, range).filter((m) => m.warehouseId === depot.id).sort((a, b) => b.date.localeCompare(a.date)),
    [purchases, sales, range, depot.id],
  )
  // A busy depot has hundreds of movements in a quarter; paged so the dialog
  // opens on the latest ten instead of a scroll past everything else in it.
  const openRecord = useOpenRecord()
  const PAGE = 10
  const [page, setPage] = useState(1)
  const totalPages = Math.max(1, Math.ceil(moves.length / PAGE))
  const shown = moves.slice((Math.min(page, totalPages) - 1) * PAGE, Math.min(page, totalPages) * PAGE)

  const onHand = Math.max(now.onHand, 0)
  const pct = depot.capacityLiters > 0 ? Math.round((onHand / depot.capacityLiters) * 100) : null
  const shortName = depot.name.replace(' depot', '')

  const ids = ['dd-activity', 'dd-sources', 'dd-level']
  const { active, jump } = useSectionNav(ids)
  const navSections: FormNavSection[] = [
    { id: 'dd-activity', title: 'Activity', state: 'todo' },
    { id: 'dd-sources', title: 'Sources', state: 'todo' },
    { id: 'dd-level', title: 'Level', state: 'todo' },
  ]

  const sourceRows = Object.entries(then.sources)
    .map(([id, liters]) => ({ id, liters, name: id === '?' ? 'Unknown' : (suppliers.find((s) => s.id === id)?.name ?? '—') }))
    .sort((a, b) => b.liters - a.liters)
  const sourceTotal = sourceRows.reduce((a, b) => a + b.liters, 0)

  return (
    <Dialog
      open
      title={depot.name}
      subtitle={`${fmtLiters(onHand)} on hand${pct !== null ? ` · ${pct}% of ${fmtLiters(depot.capacityLiters)}` : ''}`}
      onClose={onClose}
      width={WIDE_DIALOG}
      nav={<FormNav sections={navSections} active={active} onJump={jump} />}
      rail={
        <>
          <RailSection title="Today">
            <RailRow label="On hand" value={fmtLiters(onHand)} />
            <RailRow label="Capacity" value={depot.capacityLiters > 0 ? fmtLiters(depot.capacityLiters) : 'not set'} />
            <RailRow label="Avg cost" value={now.avgCost === null ? '—' : `₱${now.avgCost.toFixed(2)}/L`} />
            <RailRow label="Value" value={now.value === null ? '—' : fmtCurrency(now.value)} />
            <RailRow
              label="Cover"
              value={cover.days === null ? 'no sales' : cover.days < 1 ? 'under a day' : `${Math.round(cover.days)} days`}
            />
          </RailSection>
          <RailSection title="This range">
            <RailRow label="In" value={flow.in > 0 ? fmtLiters(flow.in) : '—'} />
            <RailRow label="Out" value={flow.out > 0 ? fmtLiters(flow.out) : '—'} />
            <RailRow label="Net" value={flow.net === 0 ? '—' : `${flow.net > 0 ? '+' : ''}${fmtNum(flow.net)} L`} />
            <RailRow label="Avg fill" value={util ? `${Math.round(util.avg * 100)}%` : '—'} />
          </RailSection>
          {cover.days !== null && cover.windowDays < 30 && (
            <RailAside>Cover is from the {cover.windowDays} days this depot has traded.</RailAside>
          )}
        </>
      }
    >
      <FormSection first id="dd-activity" right={<span className="whitespace-nowrap font-normal normal-case tracking-normal text-mut">{fmtDate(range.from)} – {fmtDate(range.to)}</span>}>
        Activity · {moves.length}
      </FormSection>
      {moves.length === 0 ? (
        <p className="m-0 font-meta text-[12px] text-mut">Nothing moved in or out of {shortName} in this range.</p>
      ) : (
        <table className="w-full border-collapse">
          <tbody>
            {shown.map((m) => {
              const href = recordHref(m.tbl, m.recordId)
              const who = m.tbl === 'purchases'
                ? suppliers.find((x) => x.id === m.counterpartyId)?.name
                : customers.find((x) => x.id === m.counterpartyId)?.company
              const verb = m.kind === 'receipt' ? 'Received from' : m.kind === 'return' ? 'Returned by' : 'Sold to'
              // Close this dialog first: a purchase opens on the same Inventory
              // screen, and two dialogs stacked is not "taking them to it".
              const open = () => { if (href) { onClose(); openRecord(href) } }
              // The whole row opens the sale or purchase behind the movement,
              // not just the name - a click anywhere on the line is the
              // natural gesture, and the arrow says the row goes somewhere.
              return (
                <tr
                  key={m.id}
                  role={href ? 'link' : undefined}
                  tabIndex={href ? 0 : undefined}
                  aria-label={href ? `Open ${m.tbl === 'purchases' ? 'purchase' : 'sale'}: ${verb} ${who ?? ''}` : undefined}
                  onClick={open}
                  onKeyDown={(e) => { if (e.key === 'Enter') open() }}
                  className={`group border-b border-linesoft last:border-b-0 ${href ? 'cursor-pointer hover:bg-paper' : ''}`}
                >
                  <td className={`${td} w-[90px] pl-0 font-meta text-[12px] text-mut`}>{fmtDate(m.date)}</td>
                  <td className={td}>
                    <span className="text-[13px]">
                      {verb}{' '}
                      <span className={`font-semibold ${href ? 'text-lab group-hover:underline' : ''}`}>{who ?? '—'}</span>
                    </span>
                  </td>
                  <td className={`${td} tnum pr-0 text-right text-[13px] font-semibold ${m.liters < 0 ? 'text-lab' : 'text-teal'}`}>
                    <span className="inline-flex items-center gap-[6px]">
                      {m.liters > 0 ? '+' : ''}{fmtNum(m.liters)} L
                      {href && <GoArrow className="text-faint opacity-0 transition-opacity group-hover:opacity-100" />}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      {moves.length > PAGE && (
        <div className="-mx-[14px]">
          <Pager page={Math.min(page, totalPages)} totalPages={totalPages} setPage={setPage} total={moves.length} pageSize={PAGE} noun="movements" />
        </div>
      )}

      <FormSection id="dd-sources" right={
        <span className="flex items-center gap-[8px] whitespace-nowrap font-normal normal-case tracking-normal">
          <span className="text-mut">as of</span>
          <Input type="date" value={asOf} max={today} onChange={(e) => setAsOf(e.target.value || today)} aria-label="Sources as of" className="h-[28px] w-[150px]" />
        </span>
      }>
        Sources
        <InfoTip label="Sources">
          What remains of each supplier's deliveries on the chosen day. A sale draws
          from every supplier's litres in proportion to their share at the time.
        </InfoTip>
      </FormSection>
      {sourceRows.length === 0 ? (
        <p className="m-0 font-meta text-[12px] text-mut">Nothing in the tank on {fmtDate(asOf)}.</p>
      ) : (
        <>
          <div className="flex h-[10px] overflow-hidden rounded-full bg-fill2" role="img" aria-label="Share of stock by supplier">
            {sourceRows.map((r) => (
              <span key={r.id} style={{ width: `${(r.liters / sourceTotal) * 100}%`, background: r.id === '?' ? '#c8ced3' : supplierColor(r.id, suppliers) }} />
            ))}
          </div>
          <table className="mt-[10px] w-full border-collapse" aria-label="Stock by supplier">
            <tbody>
              {sourceRows.map((r) => (
                <tr key={r.id} className="border-b border-linesoft last:border-b-0">
                  <td className={`${td} pl-0`}>
                    <span className="inline-flex items-center gap-[8px] text-[13px] font-semibold">
                      <span className="h-[8px] w-[8px] rounded-full" style={{ background: r.id === '?' ? '#c8ced3' : supplierColor(r.id, suppliers) }} />
                      {r.name}
                    </span>
                  </td>
                  <td className={`${td} tnum text-right text-[13px]`}>{fmtLiters(r.liters)}</td>
                  <td className={`${td} tnum w-[64px] pr-0 text-right font-meta text-[12px] text-mut`}>{Math.round((r.liters / sourceTotal) * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="m-0 mt-[8px] font-meta text-[12px] text-mut">
            {fmtLiters(sourceTotal)} in the tank on {fmtDate(asOf)}
            {then.avgCost !== null && ` · average cost ₱${then.avgCost.toFixed(2)}/L`}
          </p>
        </>
      )}

      <FormSection id="dd-level" right={util && (
        <span className="whitespace-nowrap font-normal normal-case tracking-normal text-mut">
          avg {Math.round(util.avg * 100)}% · peak {Math.round(util.peak * 100)}% · low {Math.round(util.low * 100)}% full
        </span>
      )}>
        Level
      </FormSection>
      <div className="h-[180px]">
        <LevelChart series={series.map((p) => ({ t: p.t, v: Math.max(p.values[depot.id] ?? 0, 0) }))} capacity={depot.capacityLiters} from={Date.parse(range.from)} to={Date.parse(range.to)} />
      </div>
    </Dialog>
  )
}

function LevelChart({ series, capacity, from, to }: { series: { t: number; v: number }[]; capacity: number; from: number; to: number }) {
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(from + f * (to - from)))
  const fmtTick = (t: number) => new Date(t).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })
  const top = Math.max(capacity, ...series.map((p) => p.v), 1)
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={series} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
        <defs>
          <linearGradient id="depotLevelFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={TEAL_BRIGHT} stopOpacity={0.32} />
            <stop offset="100%" stopColor={TEAL_BRIGHT} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <XAxis type="number" dataKey="t" domain={[from, to]} ticks={ticks} tickFormatter={fmtTick} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: TICK }} />
        <YAxis hide domain={[0, top]} />
        {capacity > 0 && <ReferenceLine y={capacity} stroke={CURSOR} strokeDasharray="4 3" label={{ value: 'capacity', position: 'insideTopRight', fontSize: 11, fill: TICK }} />}
        <Tooltip
          cursor={{ stroke: CURSOR, strokeDasharray: '4 3' }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null
            const p = payload[0].payload as { t: number; v: number }
            return (
              <div className="rounded-[6px] border border-line bg-white px-[10px] py-[6px] font-meta text-[12px] shadow-[0_4px_12px_rgba(20,24,27,.08)]">
                <span className="text-mut">{fmtDate(new Date(p.t).toISOString())}</span> · <span className="font-semibold">{fmtLiters(p.v)}</span>
                {capacity > 0 && <span className="text-mut"> · {Math.round((p.v / capacity) * 100)}%</span>}
              </div>
            )
          }}
        />
        <Area type="linear" dataKey="v" isAnimationActive={false} stroke={TEAL} strokeWidth={2.5} fill="url(#depotLevelFill)" activeDot={{ r: 4 }} />
      </AreaChart>
    </ResponsiveContainer>
  )
}
