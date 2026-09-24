import { AGING_BUCKETS, outstandingByCustomer } from '../../lib/metrics'
import { fmtCurrency, fmtDate } from '../../lib/format'
import { Card, DataTable, InfoTip, td } from '../../components/ui'
import { Link } from 'react-router-dom'
import { recordHref } from '../../lib/deepLink'
import type { Customer, Personnel, Sale } from '../../data/types'

const bucketLabels: Record<string, string> = {
  'current': 'Current',
  '1-30': '1–30',
  '31-60': '31–60',
  '61-90': '61–90',
  '90+': '90+',
}

/** Per-customer outstanding-balance report with standard AR aging - biggest balance first.
 * Customers with nothing open aren't listed. Amounts come straight from
 * outstandingByCustomer() in metrics.ts; aging buckets sum to the outstanding column. */
export default function BalancesTab({ sales, customers, personnel }: {
  sales: Sale[]
  customers: Customer[]
  personnel: Personnel[]
}) {
  const balances = outstandingByCustomer(sales)
  const customer = (id: string) => customers.find((c) => c.id === id)
  const names = (ids: string[]) => ids.map((id) => personnel.find((p) => p.id === id)?.name ?? '—').join(', ')

  const peso = (v: number) => (v > 0 ? fmtCurrency(v).replace('.00', '') : '—')
  const totals = balances.reduce((acc, b) => {
    acc.outstanding += b.outstanding
    acc.overdue += b.overdue
    for (const k of AGING_BUCKETS) acc.aging[k] += b.aging[k]
    return acc
  }, { outstanding: 0, overdue: 0, aging: { 'current': 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0 } })

  return (
    <Card delay={150}>
      <div className="flex items-baseline gap-[10px] border-b border-linesoft px-[14px] py-[10px]">
        {/* The page above this card is called Outstanding balances too. */}
        <span className="font-meta text-[12px] text-mut">{balances.length} with a balance</span>
        <InfoTip label="How the ageing columns work">
          Buckets are days past due, so a balance moves right as it ages. Money collected but not
          yet cleared - a check in hand or at the bank - is on the balance but in no bucket, since it
          is not late; it shows as “in flight” under the name. The same boundaries age the To collect
          card on Home.
        </InfoTip>
      </div>
      <DataTable
        empty="No customer owes anything right now."
        cols={[
          { label: 'Customer' }, { label: 'Outstanding', align: 'right' },
          ...AGING_BUCKETS.map((b) => ({ label: bucketLabels[b], align: 'right' as const })),
          { label: 'Next due' }, { label: 'Collector(s)' },
        ]}
      >
        {balances.map((b) => {
          const c = customer(b.customerId)
          return (
            <tr key={b.customerId} className="hover:bg-hovrow">
              <td className={`${td} pl-[14px]`}>
                {/* The customer opens their account - the sales, the terms,
                    the credit history behind this balance. */}
                <Link to={recordHref('customers', b.customerId) ?? '#'} className="m-0 block font-semibold text-ink no-underline hover:underline">{c?.company ?? '—'}</Link>
                <p className="m-0 text-[12px] text-faint">
                  {b.openCount} open installment{b.openCount === 1 ? '' : 's'}
                  {b.inFlight > 0 && <> · {fmtCurrency(b.inFlight).replace('.00', '')} in flight</>}
                </p>
              </td>
              <td className={`${td} whitespace-nowrap text-right`}>
                <p className="m-0 font-semibold">{peso(b.outstanding)}</p>
                {b.overdue > 0 && <p className="m-0 text-[12px] font-semibold text-redtext">{peso(b.overdue)} overdue</p>}
              </td>
              {AGING_BUCKETS.map((k) => (
                <td key={k} className={`${td} tnum whitespace-nowrap text-right ${k === 'current' || b.aging[k] === 0 ? 'text-mut' : 'font-semibold text-redtext'}`}>
                  {peso(b.aging[k])}
                </td>
              ))}
              <td className={`${td} whitespace-nowrap text-mut`}>{b.nextDue ? fmtDate(b.nextDue) : '—'}</td>
              <td className={`${td} pr-[14px] font-meta text-[12px] text-mut`}>{b.collectorIds.length > 0 ? names(b.collectorIds) : 'Unassigned'}</td>
            </tr>
          )
        })}
        {balances.length > 0 && (
          <tr className="bg-paper">
            <td className={`${td} pl-[14px] font-semibold`}>Total</td>
            <td className={`${td} whitespace-nowrap text-right font-semibold`}>{peso(totals.outstanding)}</td>
            {AGING_BUCKETS.map((k) => (
              <td key={k} className={`${td} tnum whitespace-nowrap text-right font-semibold`}>{peso(totals.aging[k])}</td>
            ))}
            <td className={td} />
            <td className={`${td} pr-[14px]`} />
          </tr>
        )}
      </DataTable>
    </Card>
  )
}
