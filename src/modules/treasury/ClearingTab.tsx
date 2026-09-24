import { Card, Chip, DataTable, MiniDark, td } from '../../components/ui'
import { fmtCurrency, fmtDate } from '../../lib/format'
import { RecordLink } from '../../lib/peek'
import { recordHref } from '../../lib/deepLink'
import type { SaleInstallmentEntry } from '../../lib/metrics'
import type { BankAccount, Customer } from '../../data/types'

const DAY = 86_400_000

/**
 * Deposited and waiting on the bank.
 *
 * The window the old model had no way to show at all: the money has left the
 * customer and left the collector, and still isn't ours. Most items pass
 * through in a couple of banking days, so the ones that don't are worth
 * noticing - a check that has sat here a week is usually one somebody forgot
 * to close off, and occasionally one the bank quietly returned.
 */
export default function ClearingTab({ rows, customers, bankAccounts, onResolve }: {
  rows: SaleInstallmentEntry[]
  customers: Customer[]
  bankAccounts: BankAccount[]
  onResolve: (saleId: string, installmentId: string) => void
}) {
  const company = (id: string) => customers.find((c) => c.id === id)?.company ?? '—'
  const bank = (id?: string) => {
    const b = id ? bankAccounts.find((x) => x.id === id) : null
    return b ? `${b.bankName} ${b.accountNumberMasked}` : '—'
  }

  return (
    <Card delay={150}>
      <div className="flex flex-wrap items-center gap-[10px] border-b border-linesoft px-[14px] py-[10px]">
        <span className="text-[13px] font-semibold">Waiting on the bank</span>
        <span className="font-meta text-[12px] text-mut">{rows.length}</span>
      </div>
      <DataTable
        pageSize={12}
        empty="Nothing in clearing."
        cols={[
          { label: 'Deposited' }, { label: 'Customer' }, { label: 'Amount', align: 'right' },
          { label: 'Into' }, { label: 'Slip' }, { label: '' },
        ]}
      >
        {rows.map(({ sale: s, installment: i }) => {
          const days = i.depositedAt ? Math.floor((Date.now() - Date.parse(i.depositedAt)) / DAY) : 0
          return (
            <tr key={`${s.id}::${i.id}`} className="hover:bg-hovrow">
              <td className={`${td} whitespace-nowrap pl-5`}>
                <p className="m-0 font-semibold">{i.depositedAt ? fmtDate(i.depositedAt) : '—'}</p>
                {/* Three banking days is the usual outside edge locally; past
                    that, somebody should ring the branch rather than wait. */}
                {days > 3
                  ? <Chip status="overdue" text={`${days} days`} />
                  : <span className="font-meta text-[12px] text-faint">{days === 0 ? 'Today' : `${days}d`}</span>}
              </td>
              <td className={td}>
                {/* The customer opens the sale this payment is against -
                    the order, the plan, every payment on it - over this page. */}
                <RecordLink to={recordHref('sales', s.id) ?? '#'} className="m-0 block font-semibold text-ink no-underline hover:underline">{company(s.customerId)}</RecordLink>
                {i.referenceNo && <p className="m-0 text-[12px] text-faint">Check {i.referenceNo}</p>}
              </td>
              <td className={`${td} whitespace-nowrap text-right font-semibold`}>
                {fmtCurrency(i.amount).replace('.00', '')}
              </td>
              <td className={`${td} text-[12.5px] text-mut`}>{bank(i.bankAccountId ?? s.bankAccountId)}</td>
              <td className={`${td} text-[12.5px] text-mut`}>{i.depositSlipNo ?? '—'}</td>
              <td className={`${td} pr-5 text-right`}>
                <MiniDark onClick={() => onResolve(s.id, i.id)}>Settle</MiniDark>
              </td>
            </tr>
          )
        })}
      </DataTable>
    </Card>
  )
}
