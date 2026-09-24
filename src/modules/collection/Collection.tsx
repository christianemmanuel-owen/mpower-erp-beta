import { useState } from 'react'
import { useToast } from '../../components/Toast'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTables } from '../../lib/data'
import { repos } from '../../data/repo'
import { isInstallmentOverdue, openReceivables, unsettledReceivables } from '../../lib/metrics'
import { isCashDeskWork } from '../../lib/collectionStatus'
import PaymentPath from '../../components/PaymentPath'
import { todayISO, fmtCompactPeso } from '../../lib/format'
import { InfoTip, KpiStrip, PageHeader, PageSkeleton } from '../../components/ui'
import QueueTab from './QueueTab'
import SettleDialog from './SettleDialog'
import { PendingBanner } from '../settings/Approvals'
import { isPending } from '../../lib/approvals'
import { usePendingRecord } from '../../lib/deepLink'
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
  /** The installment being settled - Exhibit A 1.6 wants a reference number, a
   * receiving account and a reason, none of which fit on a one-click button. */
  const [settling, setSettling] = useState<
    { sale: Sale; installment: SaleInstallment; preset?: CollectionStatus } | null
  >(null)
  const toast = useToast()

  const [pendingRecord, clearPendingRecord] = usePendingRecord()

  const data = useTables(['sales', 'customers', 'personnel', 'bankAccounts', 'agents'] as const)
  if (!data) return <PageSkeleton />
  const { sales, customers, personnel, bankAccounts, agents } = data

  // A dashboard click asked for one installment ("saleId::installmentId") or,
  // from older links, a sale - in which case its first open installment is
  // the one meant. Cleared unconditionally: a record deleted since the link
  // was drawn must not leave the id retrying on every render.
  if (pendingRecord) {
    const [saleId, instId] = pendingRecord.split('::')
    const sale = sales.find((s) => s.id === saleId)
    const installment = instId
      ? sale?.installments.find((i) => i.id === instId)
      : sale?.installments.find((i) => i.status === 'pending')
    clearPendingRecord()
    if (sale && installment && !settling) setSettling({ sale, installment })
  }

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

  /**
   * A drag on the board, or the cancel action on a row, asks for an outcome -
   * it doesn't record one.
   *
   * This used to write the status straight through, which meant the two ways
   * of concluding a collection disagreed: the Settle button asked for the date
   * the money arrived, the reason a check bounced and the slip it came on,
   * while a drag into the same column asked for nothing and stamped today's
   * date. So the board quietly produced the records the dialog exists to
   * prevent. Now both roads lead to the dialog; the drag only decides which
   * outcome it opens on.
   */
  function moveInstallment(saleId: string, installmentId: string, status: CollectionStatus) {
    const sale = sales.find((s) => s.id === saleId)
    const installment = sale?.installments.find((i) => i.id === installmentId)
    if (sale && installment) setSettling({ sale, installment, preset: status })
  }

  function assignCollector(saleId: string, installmentId: string, collectorId: string | null) {
    void patchInstallment(saleId, installmentId, (i) => ({ ...i, collectorId: collectorId ?? undefined }))
  }

  /**
   * Collect's figures are about getting hold of the money, and nothing after.
   *
   * This strip used to carry Outstanding, In hand and Cleared as well - three
   * figures from further down the road, which is Treasury's stretch - and the
   * result was two modules that looked like they did the same job. Now the
   * only Treasury number here is the one card that says how much has left the
   * collectors' hands and not yet settled, because that is the handoff, and
   * the handoff is the one thing both desks need to see.
   */
  const open = openReceivables(sales)
  const toCollect = open.reduce((sum, e) => sum + e.installment.amount, 0)
  const handedOver = unsettledReceivables(sales).filter((e) => isCashDeskWork(e.installment.status))
  const handedOverAmt = handedOver.reduce((sum, e) => sum + e.installment.amount, 0)
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

  const overall = rateOverall(sales)
  const pctText = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`)

  return (
    <>
      {/* Secondary Feature 2.1 - staff see their own parked inputs where they work. */}
      <PendingBanner tbl="sales" />
      {/* No period picker here any more: nothing on this desk is a "this
          month" figure. What is due is due, and what cleared in a period is
          Treasury's number, on Treasury's page. */}
      <PageHeader
        title={PAGE_TITLES[page]}
        subtitle={(
          <span className="inline-flex items-center gap-[6px]">
            Getting hold of what customers owe. Once it is in hand, Treasury banks it.
            {/* The road a payment travels is a legend, not a dashboard: read
                once, then in the way. It lives behind the ⓘ here and is drawn
                in full, lit, on every dialog that moves a payment. */}
            <InfoTip label="How a payment moves">
              <PaymentPath desk="collection" size="sm" className="mb-[8px]" />
              Collect gets it as far as in hand. Depositing and clearing are Treasury’s, on their own page.
            </InfoTip>
          </span>
        )}
      />

      <div className="mb-[18px]">
        <KpiStrip
          delay={50}
          items={[
            {
              label: 'To collect',
              value: fmtCompactPeso(toCollect),
              tip: {
                label: 'What counts here',
                body: (
                  <>
                    Payments nobody has gone and got yet. Once a collector records one as in
                    hand it leaves this figure and becomes Treasury's to bank - see the card
                    to the right.
                  </>
                ),
              },
              sub: <span>{open.length} payment{open.length === 1 ? '' : 's'}</span>,
            },
            {
              label: 'Overdue',
              value: <span className={overdueAmt > 0 ? 'text-redtext' : undefined}>{fmtCompactPeso(overdueAmt)}</span>,
              sub: toCollect > 0
                ? <span>{Math.round((overdueAmt / toCollect) * 100)}% of to collect</span>
                : undefined,
            },
            // fmtCompactPeso renders a plain zero as "₱0.00", which is the only
            // figure on the strip carrying centavos. Nothing is due; say so.
            { label: 'Due in 7 days', value: dueSoon > 0 ? fmtCompactPeso(dueSoon) : '—' },
            // The handoff. Everything a collector has taken off a customer
            // that the bank has not yet paid out on. It is not this desk's
            // work any more, which is exactly why it is shown: the money is
            // out of the collector's hands and not yet in the account.
            {
              label: 'With Treasury',
              value: handedOverAmt > 0 ? fmtCompactPeso(handedOverAmt) : '—',
              to: '/treasury',
              tip: {
                label: 'Where this went',
                body: (
                  <>
                    Collected, and now Treasury's to deposit and clear. The customer still owes
                    it until the bank clears it, so it stays on their balance - which is why a
                    bounce needs no reversal. Open Treasury to see it banked.
                  </>
                ),
              },
              sub: handedOver.length > 0 ? <span>{handedOver.length} item{handedOver.length === 1 ? '' : 's'}</span> : undefined,
            },
            // Exhibit A 1.6 - "percentage collected on time … in aggregate".
            {
              label: 'Collected on time',
              // Only when there is something to explain: collections with no
              // date sit outside the figure.
              tip: overall.settled > overall.judged ? {
                label: 'Why the on-time figure is incomplete',
                body: (
                  <>
                    {overall.settled - overall.judged} collection
                    {overall.settled - overall.judged === 1 ? '' : 's'} have no date recorded, so they sit
                    outside this figure. Settle one and set the date to include it.
                  </>
                ),
              } : undefined,
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
        <CalendarTab sales={sales} customers={customers} personnel={personnel} />
      )}
      {page === 'balances' && <BalancesTab sales={sales} customers={customers} personnel={personnel} />}
      {page === 'collectors' && (
        <CollectorsTab sales={sales} customers={customers} personnel={personnel} onShowQueue={showQueueFor} />
      )}

      <SettleDialog
        entry={settling}
        sales={sales}
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
