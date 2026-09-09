import { collectorWorkload, installmentCollector, isInstallmentOverdue, openReceivables } from '../../lib/metrics'
import { fmtCurrency, fmtDate } from '../../lib/format'
import { Avatar, Card, Chip, InfoTip, SectionLabel } from '../../components/ui'
import { rateByCollector, rateByCustomer } from '../../lib/collection'
import type { Customer, Personnel, Sale } from '../../data/types'

/** Who's collecting what: one card per person in charge (resolved installment → sale), with
 * their open items listed due-soonest first. Installments with no collector at either level
 * group under "Unassigned" so nothing silently drops off the radar. */
/** Clients listed before the tail is summarised. */
const CLIENTS_SHOWN = 12

export default function CollectorsTab({ sales, customers, personnel, onShowQueue }: {
  sales: Sale[]
  customers: Customer[]
  personnel: Personnel[]
  /** Open the queue filtered to one collector, or to everything unassigned. */
  onShowQueue: (collectorId: string | null) => void
}) {
  const loads = collectorWorkload(sales)
  const open = openReceivables(sales)
  const customer = (id: string) => customers.find((c) => c.id === id)
  const peso = (v: number) => fmtCurrency(v).replace('.00', '')

  // Exhibit A 1.6 - "percentage collected on time, per solicitor, per client".
  // Workload answers "who is carrying what"; these answer "who actually
  // collects". A collector with a small book and a poor rate is a different
  // problem from one with a large book and a good one.
  const collectorRates = new Map(rateByCollector(sales).map((r) => [r.key, r.rate]))
  const customerRates = rateByCustomer(sales)
  /** Worst payers first - the list anyone opens this tab to find. Ranked once
   * here so the count of what is hidden comes from the same list that is cut. */
  const rankedClients = [...customerRates]
    .filter((r) => r.rate.onTimeRate !== null)
    .sort((a, b) => (a.rate.onTimeRate ?? 1) - (b.rate.onTimeRate ?? 1))

  /**
   * Whether the percentages actually separate anyone.
   *
   * Same rule as the agent leaderboard on the dashboard: a list that scores
   * every row identically is not a ranking, it is a list pretending to be one.
   * With no collection dates recorded every client sits at 0% and the order is
   * arbitrary. The rows still carry their settled and overdue counts, which are
   * real, so the card stays - it just stops implying a league table and sorts
   * by what it can actually tell apart.
   */
  const ratesSeparate = new Set(rankedClients.map((r) => r.rate.onTimeRate)).size > 1
  const clientRows = ratesSeparate
    ? rankedClients
    : [...rankedClients].sort((a, b) => b.rate.openOverdue - a.rate.openOverdue)
  const pctText = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`)
  const rateTone = (v: number | null) =>
    v === null ? 'text-faint' : v >= 0.9 ? 'text-greentext' : v >= 0.7 ? 'text-lab' : 'text-redtext'

  if (loads.length === 0) {
    return (
      <Card className="p-8 text-center text-[13px] text-faint" delay={150}>
        Nothing waiting to be collected.
      </Card>
    )
  }

  return (
    <>
    <div className="grid grid-cols-2 items-start gap-[18px]">
      {loads.map((load, idx) => {
        const person = load.collectorId ? personnel.find((p) => p.id === load.collectorId) : null
        const name = person?.name ?? (load.collectorId ? '—' : 'Unassigned')
        const items = open
          .filter((e) => installmentCollector(e.sale, e.installment) === load.collectorId)
          .sort((a, b) => a.installment.dueDate.localeCompare(b.installment.dueDate))
        return (
          <Card key={load.collectorId ?? 'unassigned'} className="p-5" delay={150 + idx * 50}>
            <div className="flex items-center gap-[10px]">
              {load.collectorId
                ? <Avatar name={name} size={30} />
                : <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full border border-dashed border-inputline" />}
              <div>
                <p className="m-0 text-[14px] font-semibold">{name}</p>
                <p className="m-0 text-[12px] text-mut">
                  {load.openCount} open · {peso(load.amount)}
                  {load.overdueAmount > 0 && <span className="font-semibold text-redtext"> · {peso(load.overdueAmount)} overdue</span>}
                </p>
              </div>
              {(() => {
                // Unassigned work has no collector, so there is nobody for it
                // to be on time. Scoring the bucket 0% blamed a person who does
                // not exist - and on this data that bucket holds almost
                // everything, so the tab opened on a damning figure attached to
                // nobody.
                if (!load.collectorId) {
                  return (
                    <span className="ml-auto font-meta text-[12px] text-ambertext">
                      Needs a collector
                    </span>
                  )
                }
                const rate = collectorRates.get(load.collectorId)
                if (!rate) return null
                return (
                  <div className="ml-auto text-right">
                    <p className="m-0 text-[10.5px] font-semibold uppercase tracking-wide text-faint">On time</p>
                    <p className={`tnum m-0 text-[18px] font-semibold ${rateTone(rate.onTimeRate)}`}>
                      {pctText(rate.onTimeRate)}
                    </p>
                    {rate.avgDaysLate !== null && (
                      <p className="m-0 text-[11px] text-faint">avg {rate.avgDaysLate}d late</p>
                    )}
                  </div>
                )
              })()}
            </div>
            <div className="mt-3 border-t border-fill2 pt-3">
              <SectionLabel>Due next</SectionLabel>
              <div className="mt-2 flex flex-col gap-[6px]">
                {items.slice(0, 5).map(({ sale: s, installment: inst }) => (
                  <div key={`${s.id}::${inst.id}`} className="flex items-center gap-2 text-[12.5px]">
                    <span className="w-[84px] shrink-0 whitespace-nowrap text-mut">{fmtDate(inst.dueDate).replace(', 2026', '')}</span>
                    <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-semibold">{customer(s.customerId)?.company ?? '—'}</span>
                    <span className="tnum whitespace-nowrap font-semibold">{peso(inst.amount)}</span>
                    {isInstallmentOverdue(inst) && <Chip status="overdue" text="Overdue" />}
                  </div>
                ))}
                {/* This used to name 98 more collections and give you nowhere
                    to go. It is the obvious thing to click, so it is now the
                    way into the queue, filtered to this collector. */}
                <button
                  type="button"
                  onClick={() => onShowQueue(load.collectorId ?? null)}
                  className="mt-[2px] cursor-pointer border-0 bg-transparent p-0 text-left font-meta text-[12px] font-semibold text-teal hover:underline"
                >
                  {items.length > 5
                    ? `See all ${items.length} in the queue`
                    : 'Open in the queue'}
                </button>
              </div>
            </div>
          </Card>
        )
      })}
    </div>

    {/* Per client - the other cut Exhibit A 1.6 asks for. Worst payers first,
        since that is the list anyone opens this tab to find. */}
    {rankedClients.length > 0 && (
      <Card className="mt-[18px] p-5" delay={300}>
        <span className="flex items-center gap-[6px]">
          <SectionLabel>{ratesSeparate ? 'Collected on time, per client' : 'Per client'}</SectionLabel>
          {!ratesSeparate && (
            <InfoTip label="Why these clients are not ranked by percentage">
              Every client scores the same, because no collection has a date recorded. Ordered by what
              is overdue instead.
            </InfoTip>
          )}
        </span>
        <div className="mt-3 flex flex-col gap-[6px]">
          {clientRows
            .slice(0, CLIENTS_SHOWN)
            .map((r) => (
              <div key={r.key} className="flex items-center gap-3 border-b border-fill2 pb-[6px] text-[13px]">
                <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-semibold">
                  {customer(r.key)?.company ?? '—'}
                </span>
                <span className="whitespace-nowrap text-[12px] text-faint">
                  {r.rate.settled} settled
                  {r.rate.bounced > 0 && <span className="text-redtext"> · {r.rate.bounced} bounced</span>}
                  {r.rate.openOverdue > 0 && <span className="text-redtext"> · {r.rate.openOverdue} overdue</span>}
                </span>
                <span className={`tnum w-[48px] whitespace-nowrap text-right font-semibold ${rateTone(r.rate.onTimeRate)}`}>
                  {pctText(r.rate.onTimeRate)}
                </span>
              </div>
            ))}
        </div>
        {rankedClients.length > CLIENTS_SHOWN && (
          <p className="m-0 mt-[8px] font-meta text-[12px] text-mut">
            {rankedClients.length - CLIENTS_SHOWN} more client{rankedClients.length - CLIENTS_SHOWN === 1 ? '' : 's'} not shown.
          </p>
        )}
      </Card>
    )}
    </>
  )
}
