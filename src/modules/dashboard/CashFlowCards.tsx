import { ModuleLink } from '../../components/ModuleLink'
import { RecordLink } from '../../lib/peek'
import { Link } from 'react-router-dom'
import { useState } from 'react'
import { Avatar, Card, Gauge, InfoTip, filterCls } from '../../components/ui'
import { fmtCurrency, fmtDate, fmtLiters } from '../../lib/format'
import type { AgentStat } from '../../lib/metrics'
import { ageingRows } from './ageing'
import { recordHref } from '../../lib/deepLink'
import { installmentCollector, isInstallmentOverdue, saleInstallmentEntries } from '../../lib/metrics'
import type { Customer, Personnel, Sale } from '../../data/types'

/**
 * The two Cash flow cards that were stat blocks pretending to be answers.
 *
 * To collect printed one number, then a bar showing what share of it was
 * overdue. On this deployment every peso is overdue, so the bar rendered a
 * solid red slab at 100% - a proportion bar can only say something when the
 * proportion varies, and "all of it" is exactly the case it cannot draw. The
 * same number also appeared twice in two formats, to the centavo at the top and
 * compact three lines down.
 *
 * Ageing replaces it. How overdue a receivable is, is the question a collector
 * actually asks: thirty days late and ninety days late are different problems
 * with different answers, and the old card could not tell them apart.
 *
 * Who owes it is deliberately not repeated here - Needs attention on Overview
 * names the three biggest by customer. This card is the shape of the debt.
 */

export function ToCollectCard({ sales, today }: { sales: Sale[]; today: string }) {
  const { rows, total, count, overdue: overdueTotal } = ageingRows(sales, today)

  return (
    <Card className="flex flex-col">
      <div className="flex items-center gap-[10px] border-b border-linesoft bg-paper px-[14px] py-[10px]">
        <span className="text-[13px] font-semibold">To collect</span>
        <ModuleLink to="/collection" className="ml-auto" />
      </div>

      <div className="flex flex-1 flex-col p-[14px]">
        {/* In full: the client reads these as money, and ₱26.00M hides the
            difference between ₱25,995,000 and ₱26,004,000. */}
        <p className="tnum m-0 font-display text-[26px] font-semibold leading-[1.1] tracking-[-0.02em]">
          {fmtCurrency(total)}
        </p>
        <p className="m-0 mt-[3px] font-meta text-[12px] text-mut">
          {count} open installment{count === 1 ? '' : 's'}
          {overdueTotal > 0 && total > 0 && (
            <span className="font-semibold text-redtext">
              {' · '}{Math.round((overdueTotal / total) * 100)}% overdue
            </span>
          )}
        </p>

        {count === 0 ? (
          <p className="m-0 flex-1 py-7 text-center text-[13px] text-faint">Nothing outstanding.</p>
        ) : (
          <div className="mt-[14px] flex flex-col gap-[10px]">
            {rows.map((r) => (
              <div key={r.key}>
                <div className="mb-[5px] flex items-baseline justify-between font-meta text-[12px]">
                  <span className={r.count === 0 ? 'text-faint' : 'text-lab'}>{r.label}</span>
                  <span className={`tnum ${r.count === 0 ? 'text-faint' : 'font-semibold text-ink'}`}>
                    {r.count === 0 ? '—' : `${fmtCurrency(r.amount)} · ${r.count}`}
                  </span>
                </div>
                <Gauge pct={total > 0 ? Math.round((r.amount / total) * 100) : 0} color={r.tone} />
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  )
}

/** What "top" means. The client asked; the card now answers before being asked. */
const BASES = {
  volume: { label: 'Volume', of: (s: AgentStat) => s.volume },
  revenue: { label: 'Revenue', of: (s: AgentStat) => s.revenue },
  quota: { label: 'Quota %', of: (s: AgentStat) => s.quotaProgress },
} as const
type Basis = keyof typeof BASES

/**
 * Agent ranking.
 *
 * The card used to rank on one measure and display another: the order was by
 * net volume, the number on every row was quota progress. So a row reading 62%
 * sat above one reading 80% and the card looked broken, when in fact it was
 * answering a question nobody could see it asking. "Top" has at least three
 * defensible meanings here - most litres, most pesos, furthest through quota -
 * and which one is right depends on whether you are paying commission,
 * counting revenue or reviewing a target. So it is now a choice, stated in the
 * header, and every row carries all three figures whichever is picked: the
 * order changes, nothing is hidden.
 *
 * Quota is prorated to the selected range, not the calendar month, which is
 * why the litres it is measured against are printed beside the percentage.
 * Volume and revenue are both net - a cancelled order earns nothing, and a
 * returned one earns only the part that wasn't sent back.
 *
 * It also used to rank when it had nothing to rank. With no sales in the
 * selected period every agent scores zero, `stats` keeps its incoming order,
 * and the card presented an arbitrary list of names as a leaderboard. That is
 * worse than an empty state: it invents a result. It says so now instead.
 */
export function TopAgentsCard({ stats }: { stats: AgentStat[] }) {
  const [basis, setBasis] = useState<Basis>('volume')
  const ranked = stats
    .filter((s) => s.volume > 0)
    .slice()
    .sort((a, b) => BASES[basis].of(b) - BASES[basis].of(a))

  return (
    <Card className="flex flex-col">
      <div className="flex items-center gap-[8px] border-b border-linesoft bg-paper px-[14px] py-[10px]">
        <span className="whitespace-nowrap text-[13px] font-semibold">Top agents</span>
        <InfoTip label="How agents are ranked">
          Ranked by <strong>{BASES[basis].label.toLowerCase()}</strong>, highest first. Volume is net
          litres sold in the selected range, revenue is those litres at the price each was sold at -
          both with cancelled orders taken off and returns counted only for the part that came back.
          Quota % is that volume against the agent's monthly quota, prorated to the length of the
          range, which is the litre figure printed beside each percentage. Agents with no sales in
          the range aren't ranked at all.
        </InfoTip>
        <select
          value={basis}
          onChange={(e) => setBasis(e.target.value as Basis)}
          aria-label="Rank agents by"
          className={`ml-auto ${filterCls}`}
        >
          {Object.entries(BASES).map(([k, b]) => <option key={k} value={k}>{b.label}</option>)}
        </select>
        <ModuleLink to="/sales" />
      </div>

      {ranked.length === 0 ? (
        <p className="m-0 flex-1 px-[14px] py-8 text-center text-[13px] text-faint">
          {stats.length === 0
            ? 'No agents recorded yet.'
            : 'No sales in the selected period, so there is nothing to rank.'}
        </p>
      ) : (
        <div className="flex flex-1 flex-col">
          {ranked.map((s) => {
            const pct = Math.round(s.quotaProgress * 100)
            return (
              <div key={s.agent.id} className="flex items-center gap-[10px] border-b border-linesoft px-[14px] py-[9px] last:border-0">
                <Avatar name={s.agent.name} />
                {/* Nothing here has a fixed width. The card is half a column on
                    Sales and a quarter on Home, and a 112px right-hand block
                    left the name 60px at the narrow end: "Marco …". The row is
                    two lines and a bar, each spanning whatever is there. */}
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-[8px]">
                    <span className="min-w-0 truncate text-[13px] font-semibold">{s.agent.name}</span>
                    <span className="tnum shrink-0 font-meta text-[12px] font-semibold text-lab">{pct}%</span>
                  </span>
                  <span className="mt-[2px] flex items-baseline justify-between gap-[8px] font-meta text-[12px] text-mut">
                    <span className="tnum min-w-0 truncate">{fmtLiters(s.volume)} · {fmtCurrency(s.revenue)}</span>
                    {/* The denominator, because a bare percentage of an
                        unstated quota says nothing about how much work it took. */}
                    <span className="tnum shrink-0 text-faint">of {fmtLiters(s.quota)}</span>
                  </span>
                  <span className="mt-[6px] block">
                    {/* Past quota is still drawn full rather than overflowing. */}
                    <Gauge pct={Math.min(pct, 100)} color={pct >= 100 ? 'bg-teal' : 'bg-faint'} />
                  </span>
                </span>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}

/**
 * The overdue receivables themselves, worst first.
 *
 * To collect beside it gives the shape of the debt; this is the working list.
 * It used to be neither: it took the first six overdue installments in
 * whatever order they came out of the sales array, so on 104 overdue rows the
 * six on screen were arbitrary. Sorting by how late they are makes the top of
 * the list the top of the problem.
 *
 * Days late and the collector are here because they are what turns a row into
 * a next action. Needs attention on Overview names the three biggest by amount;
 * this ranks by age, which is a different worst.
 */
const SHOWN = 6

export function ReceivablesCard({ sales, customers, personnel, today }: {
  sales: Sale[]
  customers: Customer[]
  personnel: Personnel[]
  today: string
}) {
  const daysLate = (dueDate: string) =>
    Math.round((Date.parse(today) - Date.parse(dueDate.slice(0, 10))) / 86_400_000)

  const overdue = saleInstallmentEntries(sales)
    .filter((e) => e.installment.status === 'pending' && isInstallmentOverdue(e.installment))
    .sort((a, b) => daysLate(b.installment.dueDate) - daysLate(a.installment.dueDate))

  const shown = overdue.slice(0, SHOWN)

  return (
    <Card className="flex flex-col">
      <div className="flex items-center gap-[10px] border-b border-linesoft bg-paper px-[14px] py-[10px]">
        <span className="text-[13px] font-semibold">Overdue</span>
        {overdue.length > 0 && <span className="font-meta text-[12px] text-mut">{overdue.length}</span>}
        <ModuleLink to="/collection" className="ml-auto" />
      </div>

      {overdue.length === 0 && (
        <p className="m-0 flex-1 px-[14px] py-8 text-center text-[13px] text-faint">Nothing overdue.</p>
      )}

      {shown.map(({ sale, installment }) => {
        const customer = customers.find((c) => c.id === sale.customerId)
        const collectorId = installmentCollector(sale, installment)
        const collector = personnel.find((p) => p.id === collectorId)
        const href = recordHref('sales', sale.id)
        const late = daysLate(installment.dueDate)
        return (
          <div key={installment.id} className="flex items-center gap-3 border-b border-linesoft px-[14px] py-[9px] last:border-0">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold">
                {href
                  ? <RecordLink to={href} className="text-ink hover:underline">{customer?.company ?? 'Unknown customer'}</RecordLink>
                  : (customer?.company ?? 'Unknown customer')}
              </span>
              <span className="mt-[1px] block truncate font-meta text-[12px] text-mut">
                Due {fmtDate(installment.dueDate)} · {collector ? collector.name : 'unassigned'}
              </span>
            </span>
            <span className="shrink-0 text-right">
              <span className="tnum block font-meta text-[12px] font-semibold text-ink">
                {fmtCurrency(installment.amount).replace('.00', '')}
              </span>
              <span className="tnum mt-[1px] block font-meta text-[12px] font-semibold text-redtext">
                {late} day{late === 1 ? '' : 's'} late
              </span>
            </span>
          </div>
        )
      })}

      {/* The old card stopped at six and said nothing, which on 104 overdue
          installments read as though there were six. */}
      {overdue.length > SHOWN && (
        <Link
          to="/collection"
          className="border-t border-line px-[14px] py-[8px] font-meta text-[12px] font-semibold text-sec transition-colors hover:bg-fill2 hover:text-ink"
        >
          {overdue.length - SHOWN} more overdue
        </Link>
      )}
    </Card>
  )
}
