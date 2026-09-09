import { useMemo } from 'react'
import { repos } from '../../data/repo'
import { isInstallmentOverdue, saleInstallmentEntries, purchaseInstallmentEntries } from '../../lib/metrics'
import CashCalendar, { type CashEvent } from '../../components/CashCalendar'
import type { Customer, Purchase, Sale, Supplier } from '../../data/types'

/** The Dashboard's combined cash-flow view: pending receivables (customers) and pending
 * payables (suppliers) on one month grid. The grid itself is the shared CashCalendar -
 * the Collection module renders the receivables-only version of the same component. */
export default function CashFlowCalendar({ sales, purchases, customers, suppliers }: {
  sales: Sale[]
  purchases: Purchase[]
  customers: Customer[]
  suppliers: Supplier[]
}) {
  const events = useMemo<CashEvent[]>(() => {
    const inEvents: CashEvent[] = saleInstallmentEntries(sales)
      .filter((e) => e.installment.status === 'pending')
      .map((e) => ({
        kind: 'in' as const,
        parentId: e.sale.id,
        installmentId: e.installment.id,
        date: e.installment.dueDate.slice(0, 10),
        amount: e.installment.amount,
        name: customers.find((c) => c.id === e.sale.customerId)?.company ?? '—',
        overdue: isInstallmentOverdue(e.installment),
      }))
    const outEvents: CashEvent[] = purchaseInstallmentEntries(purchases)
      .filter((e) => e.installment.status === 'pending')
      .map((e) => ({
        kind: 'out' as const,
        parentId: e.purchase.id,
        installmentId: e.installment.id,
        date: e.installment.dueDate.slice(0, 10),
        amount: e.installment.amount,
        name: suppliers.find((x) => x.id === e.purchase.supplierId)?.name ?? '—',
        overdue: isInstallmentOverdue(e.installment),
      }))
    return [...inEvents, ...outEvents]
  }, [sales, purchases, customers, suppliers])

  async function resolve(e: CashEvent) {
    if (e.kind === 'in') {
      const sale = sales.find((s) => s.id === e.parentId)
      if (!sale) return
      const installments = sale.installments.map((i) => (
        i.id === e.installmentId ? { ...i, status: 'collected' as const, collectedAt: new Date().toISOString() } : i
      ))
      await repos.sales.update(sale.id, { installments })
    } else {
      const purchase = purchases.find((p) => p.id === e.parentId)
      if (!purchase) return
      const installments = purchase.installments.map((i) => (i.id === e.installmentId ? { ...i, status: 'paid' as const } : i))
      await repos.purchases.update(purchase.id, { installments })
    }
  }

  return <CashCalendar events={events} onResolve={resolve} />
}
