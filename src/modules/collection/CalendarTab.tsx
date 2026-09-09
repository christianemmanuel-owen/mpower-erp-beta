import { useMemo } from 'react'
import { installmentCollector, isInstallmentOverdue, openReceivables } from '../../lib/metrics'
import { Card } from '../../components/ui'
import CashCalendar, { type CashEvent } from '../../components/CashCalendar'
import type { CollectionStatus, Customer, Personnel, Sale } from '../../data/types'

/** Receivables-only month grid: every open installment on its due date, with the person in
 * charge on the entry. Payables live on the Dashboard's combined calendar, not here. */
export default function CalendarTab({ sales, customers, personnel, onMove }: {
  sales: Sale[]
  customers: Customer[]
  personnel: Personnel[]
  onMove: (saleId: string, installmentId: string, status: CollectionStatus) => void
}) {
  const events = useMemo<CashEvent[]>(() => openReceivables(sales).map((e) => {
    const company = customers.find((c) => c.id === e.sale.customerId)?.company ?? '—'
    const collectorId = installmentCollector(e.sale, e.installment)
    const collector = collectorId ? personnel.find((p) => p.id === collectorId)?.name : null
    return {
      kind: 'in' as const,
      parentId: e.sale.id,
      installmentId: e.installment.id,
      date: e.installment.dueDate.slice(0, 10),
      amount: e.installment.amount,
      name: collector ? `${company} · ${collector}` : company,
      overdue: isInstallmentOverdue(e.installment),
    }
  }), [sales, customers, personnel])

  return (
    <Card className="p-[14px]" delay={150}>
      <CashCalendar events={events} onResolve={(e) => onMove(e.parentId, e.installmentId, 'collected')} />
    </Card>
  )
}
