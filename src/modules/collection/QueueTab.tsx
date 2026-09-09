import { useState } from 'react'
import { Card, Chip, DataTable, MiniDark, TabBar, filterCls, td } from '../../components/ui'
import { fmtCurrency, fmtDate, label } from '../../lib/format'
import {
  installmentBankAccount, installmentCollector, isInstallmentOverdue, openReceivables,
} from '../../lib/metrics'
import { compareValues, useSortableTable } from '../../lib/sort'
import CollectionBoard from './CollectionBoard'
import type {
  Agent, BankAccount, CollectionStatus, Customer, Personnel, Sale, SaleInstallment,
} from '../../data/types'

interface Entry {
  sale: Sale
  installment: SaleInstallment
}

/** The workday view: one row per still-pending installment, due-soonest first, with inline
 * mark-collected / cancel / assign-collector. The board toggle shows the full three-column
 * kanban (which includes already-collected and cancelled cards). */
export default function QueueTab({
  collectorFilter, onCollectorFilter, sales, customers, personnel, bankAccounts, agents, onMove, onAssign, onSettle }: {
  /** Controlled, so the collectors tab can send someone here already
   * filtered to the queue they clicked. '' is everyone, 'none' is unassigned. */
  collectorFilter: string
  onCollectorFilter: (value: string) => void
  sales: Sale[]
  customers: Customer[]
  personnel: Personnel[]
  bankAccounts: BankAccount[]
  agents: Agent[]
  onMove: (saleId: string, installmentId: string, status: CollectionStatus) => void
  onAssign: (saleId: string, installmentId: string, collectorId: string | null) => void
  /** Opens the settle drawer, where Exhibit A 1.6's reference number, receiving
   * account and reason are captured. The plain onMove stays for the kanban,
   * where a drag is a status change and nothing more. */
  onSettle: (saleId: string, installmentId: string) => void
}) {
  const [view, setView] = useState<'table' | 'board'>('table')
  const [search, setSearch] = useState('')
  const [overdueOnly, setOverdueOnly] = useState(false)
  const { sort, toggle: toggleSort } = useSortableTable()

  const customer = (id: string) => customers.find((c) => c.id === id)
  const agentName = (id: string) => agents.find((a) => a.id === id)?.name ?? '—'
  const personName = (id: string | null) => (id ? personnel.find((p) => p.id === id)?.name ?? '—' : null)
  const bankLabel = (id: string | null) => {
    const b = id ? bankAccounts.find((x) => x.id === id) : null
    return b ? `${b.bankName} ${b.accountNumberMasked}` : null
  }
  const collectionAddress = (c: Customer | undefined) => c?.collectionAddress || c?.address || '—'
  const resolvedCollectorName = (s: Sale, inst: SaleInstallment) => personName(installmentCollector(s, inst))

  const sortAccessors: Record<string, (e: Entry) => string | number> = {
    due: (e) => e.installment.dueDate,
    customer: (e) => customer(e.sale.customerId)?.company ?? '',
    amount: (e) => e.installment.amount,
    collector: (e) => resolvedCollectorName(e.sale, e.installment) ?? '',
  }

  const rows = openReceivables(sales)
    .filter((e) => !overdueOnly || isInstallmentOverdue(e.installment))
    .filter((e) => !collectorFilter
      || (collectorFilter === 'none' ? installmentCollector(e.sale, e.installment) === null
        : installmentCollector(e.sale, e.installment) === collectorFilter))
    .filter((e) => !search || (customer(e.sale.customerId)?.company ?? '').toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => sort
      ? compareValues(sortAccessors[sort.key](a), sortAccessors[sort.key](b), sort.dir)
      : a.installment.dueDate.localeCompare(b.installment.dueDate))

  const activePersonnel = personnel.filter((p) => p.active !== false)

  return (
    <Card delay={150}>
      <div className="flex flex-wrap items-center gap-[10px] border-b border-linesoft px-[14px] py-[10px]">
        <span className="text-[13px] font-semibold">{view === 'table' ? 'Open collections' : 'Collections board'}</span>
        <TabBar tabs={['table', 'board'] as const} active={view} onChange={setView} />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter by customer…" className={`ml-auto w-[200px] ${filterCls}`} />
        {/* Both filters apply to both views. They used to be table-only, so
            switching to the board silently dropped whatever you had narrowed
            to and showed you everything again. */}
        <select value={collectorFilter} onChange={(e) => onCollectorFilter(e.target.value)} className={filterCls}>
          <option value="">All collectors</option>
          <option value="none">Unassigned</option>
          {activePersonnel.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <label className="flex cursor-pointer items-center gap-[6px] font-meta text-[12px] font-semibold text-sec">
          <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} />
          Overdue only
        </label>
      </div>
      {view === 'table' ? (
        <DataTable
          sort={sort}
          onSort={toggleSort}
          pageSize={10}
          resetKey={`${search}|${collectorFilter}|${overdueOnly}|${sort?.key}|${sort?.dir}`}
          empty="Nothing waiting to be collected."
          cols={[
            { label: 'Due', sortKey: 'due' }, { label: 'Customer / collection address', sortKey: 'customer' },
            { label: 'Amount', align: 'right', sortKey: 'amount' }, { label: 'Collector', sortKey: 'collector' },
            { label: 'Receiving account' }, { label: '' },
          ]}
        >
          {rows.map(({ sale: s, installment: inst }) => {
            const c = customer(s.customerId)
            const seq = s.installments.length > 1 ? s.installments.findIndex((x) => x.id === inst.id) + 1 : 0
            return (
              <tr key={`${s.id}::${inst.id}`} className="hover:bg-hovrow">
                <td className={`${td} whitespace-nowrap pl-5`}>
                  <p className="m-0 font-semibold">{fmtDate(inst.dueDate)}</p>
                  {isInstallmentOverdue(inst) && <Chip status="overdue" text="Overdue" />}
                </td>
                <td className={td}>
                  <p className="m-0 font-semibold">{c?.company ?? '—'}{seq > 0 ? <span className="font-normal text-faint"> · {seq}/{s.installments.length}</span> : null}</p>
                  <p className="m-0 text-[12px] text-faint">{collectionAddress(c)}</p>
                </td>
                <td className={`${td} whitespace-nowrap text-right`}>
                  <p className="m-0 font-semibold">{fmtCurrency(inst.amount).replace('.00', '')}</p>
                  <p className="m-0 text-[12px] text-faint">{label(s.paymentMode)}</p>
                </td>
                <td className={td}>
                  <select
                    value={inst.collectorId ?? ''}
                    onChange={(e) => onAssign(s.id, inst.id, e.target.value || null)}
                    className={`max-w-[160px] ${filterCls}`}
                  >
                    <option value="">{s.collectorId ? `Sale default (${personName(s.collectorId) ?? '—'})` : 'Unassigned'}</option>
                    {activePersonnel.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </td>
                <td className={`${td} text-[12.5px] text-mut`}>{bankLabel(installmentBankAccount(s, inst)) ?? '—'}</td>
                <td className={`${td} pr-5 text-right`}>
                  <span className="inline-flex items-center gap-3 whitespace-nowrap">
                    <MiniDark onClick={() => onSettle(s.id, inst.id)}>Settle</MiniDark>
                    <button
                      onClick={() => onMove(s.id, inst.id, 'cancelled')}
                      className="cursor-pointer px-[2px] py-1 text-[11px] font-semibold uppercase text-faint hover:text-redtext hover:underline"
                    >
                      Cancel
                    </button>
                  </span>
                </td>
              </tr>
            )
          })}
        </DataTable>
      ) : (
        <CollectionBoard
          sales={sales.filter((s) => rows.some((e) => e.sale.id === s.id))}
          customer={customer}
          agentName={agentName}
          collectorName={resolvedCollectorName}
          onMove={onMove}
        />
      )}
    </Card>
  )
}
