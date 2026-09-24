import { useState } from 'react'
import { Card, Chip, DataTable, InfoTip, MiniDark, TabBar, filterCls, td } from '../../components/ui'
import { fmtCurrency, fmtDate, label } from '../../lib/format'
import { depositOverdue, installmentCollector } from '../../lib/metrics'
import type { SaleInstallmentEntry } from '../../lib/metrics'
import { RecordLink } from '../../lib/peek'
import { recordHref } from '../../lib/deepLink'
import type { BankAccount, Customer, Personnel } from '../../data/types'

type Row = SaleInstallmentEntry & { depositDue: string }

/**
 * Everything collected and not yet banked, soonest bankable first.
 *
 * Ordered by the date each item can actually be deposited rather than by when
 * it was collected, because a post-dated check taken three weeks early cannot
 * be banked until the date on its face - putting it at the top by age would
 * send the cashier to the branch to be turned away. That date is the answer to
 * the client's "due for collection or due for depositing?": this column is the
 * second one, and it is a different date from the one Collect sorts by.
 */
export default function DepositQueue({ rows, deposited, customers, personnel, bankAccounts, onDeposit, onResolve }: {
  rows: Row[]
  /** Everything already banked, newest first - the Deposited view. */
  deposited: SaleInstallmentEntry[]
  customers: Customer[]
  personnel: Personnel[]
  bankAccounts: BankAccount[]
  onDeposit: (saleId: string, installmentId: string) => void
  /** Record what the bank said about one still in clearing. */
  onResolve: (saleId: string, installmentId: string) => void
}) {
  const [view, setView] = useState<'inhand' | 'deposited'>('inhand')
  const [search, setSearch] = useState('')
  const [readyOnly, setReadyOnly] = useState(false)
  const [days, setDays] = useState<7 | 30 | 0>(30)

  const company = (id: string) => customers.find((c) => c.id === id)?.company ?? '—'
  const who = (id: string | null) => (id ? personnel.find((p) => p.id === id)?.name ?? '—' : 'Unassigned')
  const bank = (id?: string) => {
    const b = id ? bankAccounts.find((x) => x.id === id) : null
    return b ? `${b.bankName} ${b.accountNumberMasked}` : '—'
  }

  const shown = rows
    .filter((e) => !search || company(e.sale.customerId).toLowerCase().includes(search.toLowerCase()))
    .filter((e) => !readyOnly || depositOverdue(e.depositDue))
  const since = days ? Date.now() - days * 86_400_000 : 0
  const banked = deposited
    .filter((e) => !search || company(e.sale.customerId).toLowerCase().includes(search.toLowerCase()))
    .filter((e) => !since || Date.parse(e.installment.depositedAt ?? '') >= since)
  const bankedTotal = banked.reduce((t, e) => t + e.installment.amount, 0)

  return (
    <Card delay={150}>
      <div className="flex flex-wrap items-center gap-[10px] border-b border-linesoft px-[14px] py-[10px]">
        <span className="text-[13px] font-semibold">{view === 'inhand' ? 'In hand, not deposited' : 'Deposited'}</span>
        <TabBar
          tabs={['inhand', 'deposited'] as const}
          active={view}
          onChange={setView}
          labels={{ inhand: 'In hand', deposited: 'Deposited' }}
          counts={{ inhand: shown.length, deposited: banked.length }}
        />
        {view === 'deposited' && (
          <>
            <select value={days} onChange={(e) => setDays(Number(e.target.value) as 7 | 30 | 0)} aria-label="How far back" className={filterCls}>
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={0}>All</option>
            </select>
            {bankedTotal > 0 && <span className="tnum font-meta text-[12px] text-mut">{fmtCurrency(bankedTotal).replace('.00', '')} banked</span>}
          </>
        )}
        {view === 'inhand' && <InfoTip label="How things get here">
          A payment appears here once a collector has recorded it as <b>collected</b> - on Collect,
          or on their phone. Assigning a collector on the Collect queue does not move anything here;
          it says who will go and get it. Bank transfers never come here at all: they settle on
          receipt, since there is nothing to bank.
        </InfoTip>}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by customer…"
          className={`ml-auto w-[200px] ${filterCls}`}
        />
        {view === 'inhand' && (
          <label className="flex cursor-pointer items-center gap-[6px] font-meta text-[12px] font-semibold text-sec">
            <input type="checkbox" checked={readyOnly} onChange={(e) => setReadyOnly(e.target.checked)} />
            Bankable now
          </label>
        )}
      </div>
      {view === 'deposited' ? (
        <DataTable
          key="deposited"
          pageSize={12}
          resetKey={`${search}|${days}`}
          empty={days ? `Nothing banked in the last ${days} days.` : 'Nothing banked yet.'}
          cols={[
            { label: 'Deposited' }, { label: 'Customer' }, { label: 'Amount', align: 'right' },
            { label: 'Instrument' }, { label: 'Into' }, { label: 'Bank said' }, { label: '' },
          ]}
        >
          {banked.map(({ sale: s, installment: i }) => {
            const st = i.status
            const chip = st === 'cleared' ? <Chip status="cleared" text="Cleared" />
              : st === 'bounced' ? <Chip status="overdue" text="Bounced" />
              : <Chip status="pending" text="In clearing" />
            const when = st === 'cleared' && i.clearedAt ? fmtDate(i.clearedAt)
              : st === 'bounced' && i.notes ? i.notes
              : null
            return (
              <tr key={`${s.id}::${i.id}`} className="hover:bg-hovrow">
                <td className={`${td} whitespace-nowrap pl-5`}>
                  <p className="m-0 font-semibold">{i.depositedAt ? fmtDate(i.depositedAt) : '—'}</p>
                  {i.depositSlipNo && <p className="m-0 text-[12px] text-faint">Slip {i.depositSlipNo}</p>}
                </td>
                <td className={td}>
                  {/* The customer opens the sale this deposit is against. */}
                  <RecordLink to={recordHref('sales', s.id) ?? '#'} className="m-0 block font-semibold text-ink no-underline hover:underline">{company(s.customerId)}</RecordLink>
                  <p className="m-0 text-[12px] text-faint">collected {i.collectedAt ? fmtDate(i.collectedAt) : '—'} · {who(installmentCollector(s, i))}</p>
                </td>
                <td className={`${td} whitespace-nowrap text-right font-semibold`}>
                  {fmtCurrency(i.amount).replace('.00', '')}
                </td>
                <td className={`${td} text-[12.5px] text-mut`}>
                  <p className="m-0">{label(s.paymentMode)}</p>
                  {i.referenceNo && <p className="m-0 text-[12px]">{i.referenceNo}</p>}
                </td>
                <td className={`${td} text-[12.5px] text-mut`}>{bank(i.bankAccountId ?? s.bankAccountId)}</td>
                <td className={td}>
                  {chip}
                  {when && <p className={`m-0 mt-[2px] text-[12px] ${st === 'bounced' ? 'text-redtext' : 'text-faint'}`}>{when}</p>}
                </td>
                <td className={`${td} pr-5 text-right`}>
                  {st === 'deposited' && <MiniDark onClick={() => onResolve(s.id, i.id)}>Settle</MiniDark>}
                </td>
              </tr>
            )
          })}
        </DataTable>
      ) : (
      <DataTable
        key="inhand"
        pageSize={12}
        resetKey={`${search}|${readyOnly}`}
        empty="Nothing waiting to be banked. Items arrive here once a collector records them as collected."
        cols={[
          { label: 'Bankable' }, { label: 'Customer' }, { label: 'Amount', align: 'right' },
          { label: 'Instrument' }, { label: 'Collected by' }, { label: '' },
        ]}
      >
        {shown.map(({ sale: s, installment: i, depositDue }) => {
          const ready = depositOverdue(depositDue)
          return (
            <tr key={`${s.id}::${i.id}`} className="hover:bg-hovrow">
              <td className={`${td} whitespace-nowrap pl-5`}>
                <p className="m-0 font-semibold">{fmtDate(depositDue)}</p>
                {/* Two different reasons to wait, and the cashier's next action
                    differs: one is theirs to fix, the other is the calendar's. */}
                {ready
                  ? <Chip status="overdue" text="Go to the bank" />
                  : <span className="font-meta text-[12px] text-faint">Post-dated</span>}
              </td>
              <td className={td}>
                <RecordLink to={recordHref('sales', s.id) ?? '#'} className="m-0 block font-semibold text-ink no-underline hover:underline">{company(s.customerId)}</RecordLink>
                {i.referenceNo && <p className="m-0 text-[12px] text-faint">Check {i.referenceNo}</p>}
              </td>
              <td className={`${td} whitespace-nowrap text-right font-semibold`}>
                {fmtCurrency(i.amount).replace('.00', '')}
              </td>
              <td className={`${td} text-[12.5px] text-mut`}>{label(s.paymentMode)}</td>
              <td className={`${td} text-[12.5px] text-mut`}>
                {who(installmentCollector(s, i))}
                {i.collectedAt && <span className="text-faint"> · {fmtDate(i.collectedAt)}</span>}
              </td>
              <td className={`${td} pr-5 text-right`}>
                <MiniDark onClick={() => onDeposit(s.id, i.id)}>Deposit</MiniDark>
              </td>
            </tr>
          )
        })}
      </DataTable>
      )}
    </Card>
  )
}
