import { useState } from 'react'
import { useToast } from '../../components/Toast'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTables } from '../../lib/data'
import { repos } from '../../data/repo'
import { useRange } from '../../lib/range'
import { RangePicker } from '../../lib/range'
import {
  inRange, isInstallmentOverdue, openReceivables, saleInstallmentEntries,
} from '../../lib/metrics'
import { todayISO, fmtCompactPeso } from '../../lib/format'
import { InfoTip, KpiStrip, PageHeader } from '../../components/ui'
import QueueTab from './QueueTab'
import SettleDialog from './SettleDialog'
import { PendingBanner } from '../settings/Approvals'
import { isPending } from '../../lib/approvals'
import { rateOverall } from '../../lib/collection'
import type { Sale } from '../../data/types'
import CalendarTab from './CalendarTab'
import BalancesTab from './BalancesTab'
import CollectorsTab from './CollectorsTab'
import type { CollectionStatus, SaleInstallment } from '../../data/types'

type Page = 'queue' | 'calendar' | 'balances' | 'collectors'

const PAGE_TITLES: Record<Page, string> = {
  queue: 'Collections',
  calendar: 'Collection calendar',
  balances: 'Outstanding balances',
  collectors: 'Collectors',
}

/** Collections home: everything still owed by customers, who's collecting it, and when.
 * All four tabs read from the same openReceivables() source - see metrics.ts. */
export default function Collection({ page }: { page: Page }) {
  /**
   * Which collector the queue is narrowed to, held in the URL rather than in
   * state.
   *
   * The four views are separate routes now, so the component remounts when you
   * move between them and any local filter would be lost on the way. Putting it
   * in the query string survives that, survives a refresh, and makes "the
   * unassigned queue" a link somebody can send.
   */
  const [params, setParams] = useSearchParams()
  const collectorFilter = params.get('collector') ?? ''
  const setCollectorFilter = (value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set('collector', value)
    else next.delete('collector')
    setParams(next, { replace: true })
  }

  const navigate = useNavigate()
  /** Open the queue on one collector's work - or on everything unassigned. */
  function showQueueFor(collectorId: string | null) {
    navigate(`/collection?collector=${collectorId ?? 'none'}`)
  }
  const { range } = useRange()
  /** The installment being settled - Exhibit A 1.6 wants a reference number, a
   * receiving account and a reason, none of which fit on a one-click button. */
  const [settling, setSettling] = useState<{ sale: Sale; installment: SaleInstallment } | null>(null)
  const toast = useToast()

  const data = useTables(['sales', 'customers', 'personnel', 'bankAccounts', 'agents'] as const)
  if (!data) return null
  const { sales, customers, personnel, bankAccounts, agents } = data

  /** Updates one installment inside its parent sale's array - never the whole plan. Marking
   * collected stamps collectedAt (for "collected this period"); leaving collected clears it. */
  async function patchInstallment(saleId: string, installmentId: string, patch: (i: SaleInstallment) => SaleInstallment) {
    const target = sales.find((s) => s.id === saleId)
    if (!target) return
    const result = await repos.sales.update(saleId, {
      installments: target.installments.map((i) => (i.id === installmentId ? patch(i) : i)),
    })
    if (isPending(result)) toast(result.message)
  }

  /** Applies the settle drawer's changes to one installment. */
  async function settleInstallment(saleId: string, installmentId: string, patch: Partial<SaleInstallment>) {
    await patchInstallment(saleId, installmentId, (i) => ({ ...i, ...patch }))
  }

  function openSettle(saleId: string, installmentId: string) {
    const sale = sales.find((s) => s.id === saleId)
    const installment = sale?.installments.find((i) => i.id === installmentId)
    if (sale && installment) setSettling({ sale, installment })
  }

  function moveInstallment(saleId: string, installmentId: string, status: CollectionStatus) {
    void patchInstallment(saleId, installmentId, (i) => ({
      ...i,
      status,
      collectedAt: status === 'collected' ? new Date().toISOString() : undefined,
    }))
  }

  function assignCollector(saleId: string, installmentId: string, collectorId: string | null) {
    void patchInstallment(saleId, installmentId, (i) => ({ ...i, collectorId: collectorId ?? undefined }))
  }

  const open = openReceivables(sales)
  const outstanding = open.reduce((sum, e) => sum + e.installment.amount, 0)
  const overdueAmt = open
    .filter((e) => isInstallmentOverdue(e.installment))
    .reduce((sum, e) => sum + e.installment.amount, 0)

  const today = todayISO()
  const weekOut = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)
  const dueSoon = open
    .filter((e) => {
      const d = e.installment.dueDate.slice(0, 10)
      return d >= today && d <= weekOut
    })
    .reduce((sum, e) => sum + e.installment.amount, 0)

  const collectedInRange = saleInstallmentEntries(sales)
    .filter((e) => e.installment.status === 'collected'
      && inRange(e.installment.collectedAt ?? e.installment.dueDate, range))
    .reduce((sum, e) => sum + e.installment.amount, 0)

  const overall = rateOverall(sales)
  const pctText = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`)

  return (
    <>
      {/* Secondary Feature 2.1 - staff see their own parked inputs where they work. */}
      <PendingBanner tbl="sales" />
      <PageHeader
        title={PAGE_TITLES[page]}
        right={<RangePicker />}
      />

      <div className="mb-[18px]">
        <KpiStrip
          delay={50}
          items={[
            { label: 'Outstanding', value: fmtCompactPeso(outstanding), sub: <span>{open.length} open installments</span> },
            {
              label: 'Overdue',
              value: <span className={overdueAmt > 0 ? 'text-redtext' : undefined}>{fmtCompactPeso(overdueAmt)}</span>,
              // The two cards print the same figure whenever every peso is late,
              // which on this book they are. The share says which case you are
              // looking at instead of leaving one card repeating the other.
              sub: outstanding > 0
                ? <span>{Math.round((overdueAmt / outstanding) * 100)}% of outstanding</span>
                : undefined,
            },
            // fmtCompactPeso renders a plain zero as "₱0.00", which is the only
            // figure on the strip carrying centavos. Nothing is due; say so.
            { label: 'Due in 7 days', value: dueSoon > 0 ? fmtCompactPeso(dueSoon) : '—' },
            { label: 'Collected this period', value: fmtCompactPeso(collectedInRange) },
            // Exhibit A 1.6 - "percentage collected on time … in aggregate".
            {
              label: (
                <span className="inline-flex items-center gap-[5px]">
                  Collected on time
                  {overall.settled > overall.judged && (
                    <InfoTip label="Why the on-time figure is incomplete">
                      {overall.settled - overall.judged} collection
                      {overall.settled - overall.judged === 1 ? '' : 's'} have no date recorded, so they sit
                      outside this figure. Settle one and set the date to include it.
                    </InfoTip>
                  )}
                </span>
              ),
              value: pctText(overall.onTimeRate),
              sub: (
                <span>
                  {overall.onTime} of {overall.judged + overall.bounced + overall.openOverdue} concluded
                </span>
              ),
            },
          ]}
        />
      </div>

      {page === 'queue' && (
        <QueueTab
          sales={sales} customers={customers} personnel={personnel} bankAccounts={bankAccounts}
          agents={agents} onMove={moveInstallment} onAssign={assignCollector} onSettle={openSettle}
          collectorFilter={collectorFilter} onCollectorFilter={setCollectorFilter}
        />
      )}
      {page === 'calendar' && (
        <CalendarTab sales={sales} customers={customers} personnel={personnel} onMove={moveInstallment} />
      )}
      {page === 'balances' && <BalancesTab sales={sales} customers={customers} personnel={personnel} />}
      {page === 'collectors' && (
        <CollectorsTab sales={sales} customers={customers} personnel={personnel} onShowQueue={showQueueFor} />
      )}

      <SettleDialog
        entry={settling}
        customers={customers}
        personnel={personnel}
        bankAccounts={bankAccounts}
        onClose={() => setSettling(null)}
        onSave={settleInstallment}
        onNotice={toast}
      />
    </>
  )
}
