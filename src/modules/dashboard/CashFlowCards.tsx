import { ModuleLink } from '../../components/ModuleLink'
import { Link } from 'react-router-dom'
import { Avatar, Card, Gauge } from '../../components/ui'
import { fmtCompactPeso, fmtCurrency, fmtDate, fmtLiters } from '../../lib/format'
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
        {/* One format for the headline. The old card printed this to the
            centavo and then again compact a few lines below. */}
        <p className="tnum m-0 font-display text-[28px] font-semibold leading-[1.1] tracking-[-0.02em]">
          {fmtCompactPeso(total)}
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
                    {r.count === 0 ? '—' : `${fmtCompactPeso(r.amount)} · ${r.count}`}
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

/**
 * Agent ranking against monthly quota.
 *
 * The old card printed a percentage and nothing else, so a row read "62%"
 * without saying 62% of what - and the quotas here run from 40,000 to 60,000 L,
 * so the same percentage means different work for different people. The volume
 * now sits beside it.
 *
 * It also ranked when it had nothing to rank. With no sales in the selected
 * period every agent scores zero, `stats` keeps its incoming order, and the
 * card presented an arbitrary list of names as a leaderboard. That is worse
 * than an empty state: it invents a result. It says so now instead.
 */
export function TopAgentsCard({ stats, monthLabel }: { stats: AgentStat[]; monthLabel: string }) {
  const ranked = stats.filter((s) => s.volume > 0)

  return (
    <Card className="flex flex-col">
      <div className="flex items-center gap-[10px] border-b border-linesoft bg-paper px-[14px] py-[10px]">
        <span className="text-[13px] font-semibold">Top agents</span>
        {/* Quota is monthly and does not follow the range picker, so the period
            has to be named or the percentages look like they answer it. */}
        <span className="font-meta text-[12px] text-faint">{monthLabel} quota</span>
        <ModuleLink to="/sales" className="ml-auto" />
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
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold">{s.agent.name}</span>
                  <span className="tnum mt-[2px] block font-meta text-[12px] text-mut">
                    {fmtLiters(s.volume)} · {fmtCompactPeso(s.revenue)}
                  </span>
                </span>
                <span className="w-[104px] shrink-0">
                  <span className="mb-[4px] block text-right font-meta text-[12px] font-semibold text-lab">
                    <span className="tnum">{pct}%</span>
                  </span>
                  {/* Past quota is still drawn full rather than overflowing. */}
                  <Gauge pct={Math.min(pct, 100)} color={pct >= 100 ? 'bg-teal' : 'bg-faint'} />
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
                  ? <Link to={href} className="text-ink hover:underline">{customer?.company ?? 'Unknown customer'}</Link>
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
