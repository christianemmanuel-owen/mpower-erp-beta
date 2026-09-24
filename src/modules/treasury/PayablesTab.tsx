import { useState } from 'react'
import { Card, Chip, DataTable, MiniDark, TabBar, filterCls, td } from '../../components/ui'
import { fmtCurrency, fmtDate, label } from '../../lib/format'
import { purchaseInstallmentEntries } from '../../lib/metrics'
import PayDialog, { type PayEntry } from './PayDialog'
import { RecordLink } from '../../lib/peek'
import { recordHref } from '../../lib/deepLink'
import type { BankAccount, PurchaseInstallment, Purchase, Supplier } from '../../data/types'

/**
 * What we owe suppliers, paying it, and what has been paid.
 *
 * The other half of the client's question, and the bigger gap: there was no
 * screen for this at all. A purchase's payment plan could only be edited from
 * inside the purchase form, so "what is due this week, across every supplier"
 * was a question the system held the answer to and could not be asked. It sits
 * here rather than in Stock because releasing money is Treasury work, not the
 * job of whoever receives the fuel - the same separation as the money coming
 * in, for the same reason.
 *
 * Paying opens a receipt (PayDialog) rather than flipping the row: the date,
 * the account, the check number and who released it are the record. Paid
 * rows then move to the Paid view instead of vanishing, so "did we pay
 * Petron last Tuesday, and with which check" is answerable here too.
 */
export default function PayablesTab({ purchases, suppliers, bankAccounts, onPay }: {
  purchases: Purchase[]
  suppliers: Supplier[]
  bankAccounts: BankAccount[]
  onPay: (purchaseId: string, installmentId: string, patch: Partial<PurchaseInstallment>) => Promise<void>
}) {
  const [view, setView] = useState<'due' | 'paid'>('due')
  const [supplierFilter, setSupplierFilter] = useState('')
  const [days, setDays] = useState<7 | 30 | 0>(30)
  const [paying, setPaying] = useState<PayEntry | null>(null)

  const name = (id: string) => suppliers.find((s) => s.id === id)?.name ?? '—'
  const account = (id?: string) => {
    const b = bankAccounts.find((x) => x.id === id)
    return b ? `${b.bankName} ${b.accountNumberMasked}` : null
  }

  const entries = purchaseInstallmentEntries(purchases)
    .filter((e) => !supplierFilter || e.purchase.supplierId === supplierFilter)

  const due = entries
    .filter((e) => e.installment.status === 'pending')
    .sort((a, b) => a.installment.dueDate.localeCompare(b.installment.dueDate))

  const since = days ? Date.now() - days * 86_400_000 : 0
  const paid = entries
    .filter((e) => e.installment.status === 'paid')
    .filter((e) => !since || Date.parse(e.installment.paidAt ?? e.installment.dueDate) >= since)
    .sort((a, b) => (b.installment.paidAt ?? b.installment.dueDate).localeCompare(a.installment.paidAt ?? a.installment.dueDate))
  const paidTotal = paid.reduce((s, e) => s + e.installment.amount, 0)

  const overdue = (d: string) => Date.parse(d) < Date.now()

  return (
    <>
      <Card delay={150}>
        <div className="flex flex-wrap items-center gap-[10px] border-b border-linesoft px-[14px] py-[10px]">
          <span className="text-[13px] font-semibold">{view === 'due' ? 'Due to suppliers' : 'Paid'}</span>
          <TabBar tabs={['due', 'paid'] as const} active={view} onChange={setView} counts={{ due: due.length, paid: paid.length }} />
          {view === 'paid' && (
            <>
              <select
                value={days}
                onChange={(e) => setDays(Number(e.target.value) as 7 | 30 | 0)}
                aria-label="How far back"
                className={filterCls}
              >
                <option value={7}>Last 7 days</option>
                <option value={30}>Last 30 days</option>
                <option value={0}>All</option>
              </select>
              {paidTotal > 0 && <span className="tnum font-meta text-[12px] text-mut">{fmtCurrency(paidTotal).replace('.00', '')} out</span>}
            </>
          )}
          <select
            value={supplierFilter}
            onChange={(e) => setSupplierFilter(e.target.value)}
            className={`ml-auto ${filterCls}`}
          >
            <option value="">All suppliers</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        {view === 'due' ? (
          <DataTable
            key="due"
            pageSize={12}
            resetKey={supplierFilter}
            empty="Nothing owed."
            cols={[
              { label: 'Due' }, { label: 'Supplier' }, { label: 'Amount', align: 'right' },
              { label: 'Agreed as' }, { label: '' },
            ]}
          >
            {due.map(({ purchase: p, installment: i }) => (
              <tr key={`${p.id}::${i.id}`} className="hover:bg-hovrow">
                <td className={`${td} whitespace-nowrap pl-5`}>
                  <p className="m-0 font-semibold">{fmtDate(i.dueDate)}</p>
                  {overdue(i.dueDate) && <Chip status="overdue" text="Overdue" />}
                </td>
                <td className={td}>
                  {/* The supplier opens the purchase it is owed for - the
                      volume, the PO, the plan - over this page. */}
                  <RecordLink to={recordHref('purchases', p.id) ?? '#'} className="m-0 block font-semibold text-ink no-underline hover:underline">{name(p.supplierId)}</RecordLink>
                  {p.poReferenceNo && <p className="m-0 text-[12px] text-faint">PO {p.poReferenceNo}</p>}
                </td>
                <td className={`${td} whitespace-nowrap text-right font-semibold`}>
                  {fmtCurrency(i.amount).replace('.00', '')}
                </td>
                <td className={`${td} text-[12.5px] text-mut`}>{label(p.paymentMode)}</td>
                <td className={`${td} pr-5 text-right`}>
                  <MiniDark onClick={() => setPaying({ purchase: p, installment: i })}>Pay</MiniDark>
                </td>
              </tr>
            ))}
          </DataTable>
        ) : (
          <DataTable
            key="paid"
            pageSize={12}
            resetKey={`${supplierFilter}:${days}`}
            empty={days ? `Nothing paid in the last ${days} days.` : 'Nothing paid yet.'}
            cols={[
              { label: 'Paid' }, { label: 'Supplier' }, { label: 'Amount', align: 'right' },
              { label: 'How' }, { label: 'From' }, { label: 'By' },
            ]}
          >
            {paid.map(({ purchase: p, installment: i }) => {
              const lateBy = i.paidAt ? Math.floor((Date.parse(i.paidAt) - Date.parse(i.dueDate)) / 86_400_000) : 0
              return (
                <tr
                  key={`${p.id}::${i.id}`}
                  className="cursor-pointer hover:bg-hovrow"
                  onClick={() => setPaying({ purchase: p, installment: i })}
                  title="Open the payment"
                >
                  <td className={`${td} whitespace-nowrap pl-5`}>
                    <p className="m-0 font-semibold">{i.paidAt ? fmtDate(i.paidAt) : '—'}</p>
                    <p className={`m-0 text-[12px] ${lateBy > 0 ? 'text-redtext' : 'text-faint'}`}>
                      {lateBy > 0 ? `${lateBy}d after due` : `due ${fmtDate(i.dueDate)}`}
                    </p>
                  </td>
                  <td className={td}>
                    <p className="m-0 font-semibold">{name(p.supplierId)}</p>
                    {p.poReferenceNo && <p className="m-0 text-[12px] text-faint">PO {p.poReferenceNo}</p>}
                  </td>
                  <td className={`${td} whitespace-nowrap text-right font-semibold`}>
                    {fmtCurrency(i.amount).replace('.00', '')}
                  </td>
                  <td className={`${td} text-[12.5px]`}>
                    <p className="m-0">{label(i.paymentMode ?? p.paymentMode)}</p>
                    {i.referenceNo && <p className="m-0 text-[12px] text-mut">{i.referenceNo}</p>}
                  </td>
                  <td className={`${td} text-[12.5px] text-mut`}>{account(i.bankAccountId) ?? '—'}</td>
                  <td className={`${td} pr-5 text-[12.5px] text-mut`}>
                    <span className="flex items-center justify-between gap-[8px]">
                      {i.paidByName ?? '—'}
                      <span onClick={(e) => e.stopPropagation()}><MiniDark onClick={() => setPaying({ purchase: p, installment: i })}>Open</MiniDark></span>
                    </span>
                  </td>
                </tr>
              )
            })}
          </DataTable>
        )}
      </Card>

      <PayDialog
        entry={paying}
        suppliers={suppliers}
        bankAccounts={bankAccounts}
        onClose={() => setPaying(null)}
        onSave={onPay}
      />
    </>
  )
}
