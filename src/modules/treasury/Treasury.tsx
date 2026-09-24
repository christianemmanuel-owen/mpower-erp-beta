import { useState } from 'react'
import { useToast } from '../../components/Toast'
import { useTables } from '../../lib/data'
import { repos } from '../../data/repo'
import { isPending } from '../../lib/approvals'
import {
  depositOverdue, depositedItems, itemsInClearing, purchaseInstallmentEntries, undepositedItems,
} from '../../lib/metrics'
import { fmtCompactPeso } from '../../lib/format'
import { InfoTip, KpiStrip, PageHeader, PageSkeleton } from '../../components/ui'
import { PendingBanner } from '../settings/Approvals'
import PaymentPath from '../../components/PaymentPath'
import DepositQueue from './DepositQueue'
import ClearingTab from './ClearingTab'
import PayablesTab from './PayablesTab'
import DepositDialog from './DepositDialog'
import type { PurchaseInstallment, Sale, SaleInstallment } from '../../data/types'

export type TreasuryPage = 'deposits' | 'clearing' | 'payables'

const PAGE_TITLES: Record<TreasuryPage, string> = {
  deposits: 'Deposits',
  clearing: 'Clearing',
  payables: 'Payables',
}

/**
 * The treasury: money moving through the company's bank accounts.
 *
 * It exists because the client asked where depositing client checks and paying
 * suppliers belong, having noticed that neither is the job of whoever chases
 * collections or runs the depot. They were right, and for a firmer reason than
 * tidiness: the person who receives money must not be the person who records
 * banking it, or covering a shortfall with the next customer's payment leaves
 * no trace. So this is a module of its own with a permission of its own, not a
 * page inside Collect - a seat can hold one without the other, which is the
 * entire point. The rule is enforced per field on the server; the screens here
 * only make it obvious whose work is whose.
 *
 * Supplier payments live here too, which is the other half of the client's
 * question. They had no screen at all before this - a purchase's installments
 * were editable only from inside the purchase form, so "what do we owe, and
 * when" was a question the system could not answer in one place.
 */
export default function Treasury({ page }: { page: TreasuryPage }) {
  const toast = useToast()
  const [banking, setBanking] = useState<{ sale: Sale; installment: SaleInstallment } | null>(null)
  const [stage, setStage] = useState<'deposit' | 'clear'>('deposit')

  const data = useTables(['sales', 'purchases', 'customers', 'suppliers', 'personnel', 'bankAccounts'] as const)
  if (!data) return <PageSkeleton />
  const { sales, purchases, customers, suppliers, personnel, bankAccounts } = data

  async function patchInstallment(saleId: string, installmentId: string, patch: Partial<SaleInstallment>) {
    const target = sales.find((s) => s.id === saleId)
    if (!target) return
    const result = await repos.sales.update(saleId, {
      installments: target.installments.map((i) => (i.id === installmentId ? { ...i, ...patch } : i)),
    })
    if (isPending(result)) toast(result.message)
  }

  async function patchPayable(purchaseId: string, installmentId: string, patch: Partial<PurchaseInstallment>) {
    const target = purchases.find((p) => p.id === purchaseId)
    if (!target) return
    const result = await repos.purchases.update(purchaseId, {
      installments: target.installments.map((i) => (i.id === installmentId ? { ...i, ...patch } : i)),
    })
    if (isPending(result)) toast(result.message)
  }

  function open(saleId: string, installmentId: string, which: 'deposit' | 'clear') {
    const sale = sales.find((s) => s.id === saleId)
    const installment = sale?.installments.find((i) => i.id === installmentId)
    if (!sale || !installment) return
    setStage(which)
    setBanking({ sale, installment })
  }

  const toDeposit = undepositedItems(sales)
  const clearing = itemsInClearing(sales)
  const deposited = depositedItems(sales)
  const payables = purchaseInstallmentEntries(purchases).filter((e) => e.installment.status === 'pending')

  const sum = (rows: { installment: { amount: number } }[]) =>
    rows.reduce((t, r) => t + r.installment.amount, 0)
  // Matured and still in the drawer. The one figure on this page that is a
  // problem rather than a workload.
  const lateToBank = toDeposit.filter((e) => depositOverdue(e.depositDue))

  return (
    <>
      <PendingBanner tbl="sales" />
      <PageHeader
        title={PAGE_TITLES[page]}
        subtitle={(
          <span className="inline-flex items-center gap-[6px]">
            Starts where Collect ends: banking what collectors brought in, and paying what we owe.
            {/* The road a payment travels is a legend, not a dashboard: read
                once, then in the way. It lives behind the ⓘ here and is drawn
                in full, lit, on every dialog that moves a payment. */}
            <InfoTip label="How a payment moves">
              <PaymentPath desk="treasury" size="sm" className="mb-[8px]" />
              Collect brings it as far as in hand. From there it is this desk’s: bank it, then record what the bank said.
            </InfoTip>
          </span>
        )}
      />

      <div className="mb-[18px]">
        <KpiStrip
          delay={50}
          items={[
            {
              label: 'In hand',
              value: toDeposit.length > 0 ? fmtCompactPeso(sum(toDeposit)) : '—',
              to: '/treasury',
              tip: {
                label: 'What "in hand" means',
                body: (
                  <>
                    Cash and checks collectors have received but nobody has banked yet. Until this
                    is deposited and cleared it is not the company's money in any account - it is
                    paper in somebody's custody.
                  </>
                ),
              },
              sub: <span>{toDeposit.length} item{toDeposit.length === 1 ? '' : 's'}</span>,
            },
            {
              label: 'Late to bank',
              value: lateToBank.length > 0
                ? <span className="text-redtext">{fmtCompactPeso(sum(lateToBank))}</span>
                : '—',
              tip: {
                label: 'Why this matters',
                body: (
                  <>
                    Items that could have been deposited already - a check whose own date has
                    passed, or cash received. The longer money sits undeposited the longer it is
                    outside any bank record, which is the gap this desk exists to close.
                  </>
                ),
              },
              sub: lateToBank.length > 0 ? <span>{lateToBank.length} past its date</span> : undefined,
            },
            {
              label: 'In clearing',
              value: clearing.length > 0 ? fmtCompactPeso(sum(clearing)) : '—',
              to: '/treasury/clearing',
              tip: {
                label: 'Banked, not yet settled',
                body: <>Lodged with the bank and waiting on it. Still owed by the customer until it clears.</>,
              },
              sub: <span>{clearing.length} waiting</span>,
            },
            {
              label: 'Owed to suppliers',
              value: payables.length > 0 ? fmtCompactPeso(sum(payables)) : '—',
              to: '/treasury/payables',
              sub: <span>{payables.length} unpaid</span>,
            },
          ]}
        />
      </div>

      {page === 'deposits' && (
        <DepositQueue
          rows={toDeposit}
          deposited={deposited}
          customers={customers}
          personnel={personnel}
          bankAccounts={bankAccounts}
          onDeposit={(saleId, instId) => open(saleId, instId, 'deposit')}
          onResolve={(saleId, instId) => open(saleId, instId, 'clear')}
        />
      )}
      {page === 'clearing' && (
        <ClearingTab
          rows={clearing}
          customers={customers}
          bankAccounts={bankAccounts}
          onResolve={(saleId, instId) => open(saleId, instId, 'clear')}
        />
      )}
      {page === 'payables' && (
        <PayablesTab
          purchases={purchases}
          suppliers={suppliers}
          bankAccounts={bankAccounts}
          onPay={patchPayable}
        />
      )}

      <DepositDialog
        entry={banking}
        stage={stage}
        customers={customers}
        bankAccounts={bankAccounts}
        onClose={() => setBanking(null)}
        onSave={patchInstallment}
      />
    </>
  )
}
