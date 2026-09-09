import { useState } from 'react'
import { Chip } from '../../components/ui'
import { fmtCurrency, fmtDate, fmtLiters } from '../../lib/format'
import { isInstallmentOverdue, purchaseInstallmentEntries } from '../../lib/metrics'
import type { Purchase, PurchasePaymentStatus } from '../../data/types'

// No colour per column. The heading names the state, and three dots in three
// colours were saying the same thing a second time.
const columns: { status: PurchasePaymentStatus; title: string }[] = [
  { status: 'pending', title: 'Pending' },
  { status: 'paid', title: 'Paid' },
  { status: 'cancelled', title: 'Cancelled' },
]

const pageSize = 5

/** Drag-and-drop board for individual purchase installments (pending/paid/cancelled) - the
 * accounts-payable mirror of SalesBoard. Each card is one installment, not one purchase.
 * "Overdue" isn't a column here either - it's a badge computed from a pending card's due date. */
export default function PurchaseBoard({ purchases, supplierName, warehouseName, onMove }: {
  purchases: Purchase[]
  supplierName: (id: string) => string
  warehouseName: (id: string) => string
  onMove: (purchaseId: string, installmentId: string, status: PurchasePaymentStatus) => void
}) {
  const [dragKey, setDragKey] = useState<string | null>(null)
  const [overCol, setOverCol] = useState<PurchasePaymentStatus | null>(null)
  const [page, setPage] = useState<Record<PurchasePaymentStatus, number>>({ pending: 0, paid: 0, cancelled: 0 })

  const entries = purchaseInstallmentEntries(purchases)
  const board = columns.map((col) => {
    const items = entries
      .filter((e) => e.installment.status === col.status)
      .sort((a, b) => b.purchase.date.localeCompare(a.purchase.date))
    const totalPages = Math.max(1, Math.ceil(items.length / pageSize))
    const current = Math.min(page[col.status], totalPages - 1)
    return { ...col, items, totalPages, current, pageItems: items.slice(current * pageSize, current * pageSize + pageSize) }
  })

  function setColPage(status: PurchasePaymentStatus, p: number) {
    setPage((prev) => ({ ...prev, [status]: p }))
  }

  function drop(status: PurchasePaymentStatus) {
    if (dragKey) {
      const [purchaseId, installmentId] = dragKey.split('::')
      onMove(purchaseId, installmentId, status)
    }
    setDragKey(null)
    setOverCol(null)
  }

  return (
    <div className="p-[14px]">
      <div className="grid grid-cols-3 items-start gap-3">
        {board.map((col) => (
          <div
            key={col.status}
            onDragOver={(e) => { e.preventDefault(); setOverCol(col.status) }}
            onDragLeave={() => setOverCol((c) => (c === col.status ? null : c))}
            onDrop={(e) => { e.preventDefault(); drop(col.status) }}
            // The grey tub is gone. A column is a heading, a rule and its cards
            // on the page ground - three filled panels side by side read as the
            // furniture rather than the work.
            className="rounded-[8px] transition-colors"
          >
            <div className="mb-2 flex items-baseline gap-2 border-b border-line pb-[6px]">
              <p className="m-0 text-[13px] font-semibold">{col.title}</p>
              <span className="font-meta text-[12px] text-mut">{col.items.length}</span>
            </div>
            <div
              className={`flex min-h-[64px] flex-col gap-2 rounded-[6px] p-[2px] transition-colors ${
                overCol === col.status ? 'bg-fill2 outline-dashed outline-1 outline-inputline' : ''
              }`}
            >
              {col.pageItems.map(({ purchase: p, installment: inst }) => {
                const key = `${p.id}::${inst.id}`
                const seq = p.installments.length > 1 ? p.installments.findIndex((x) => x.id === inst.id) + 1 : 0
                return (
                  <div
                    key={key}
                    draggable
                    onDragStart={(e) => { e.dataTransfer.setData('text/plain', key); setDragKey(key) }}
                    onDragEnd={() => { setDragKey(null); setOverCol(null) }}
                    className={`cursor-grab rounded-[6px] border border-line bg-white p-[10px] transition-colors hover:border-inputline active:cursor-grabbing ${dragKey === key ? 'opacity-40' : ''}`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="tnum text-[13px] font-semibold">{fmtCurrency(inst.amount).replace('.00', '')}</span>
                      <span className="tnum font-meta text-[12px] text-faint">{fmtDate(inst.dueDate).replace(', 2026', '')}</span>
                    </div>
                    <p className="m-0 mt-[2px] truncate text-[13px]">{supplierName(p.supplierId)}</p>
                    <p className="m-0 truncate font-meta text-[12px] text-mut">
                      {fmtLiters(p.volumeLiters)} · {warehouseName(p.warehouseId)}{seq > 0 ? ` · ${seq}/${p.installments.length}` : ''}
                    </p>
                    {isInstallmentOverdue(inst) && (
                      <span className="mt-[6px] inline-flex"><Chip status="overdue" text="Overdue" /></span>
                    )}
                  </div>
                )
              })}
              {col.items.length === 0 && (
                <p className="m-0 rounded-[6px] border border-dashed border-line py-5 text-center font-meta text-[12px] text-faint">Nothing here</p>
              )}
            </div>
            {col.totalPages > 1 && (
              <div className="mt-2 flex items-center justify-between font-meta text-[12px] text-mut">
                <button
                  onClick={() => setColPage(col.status, col.current - 1)}
                  disabled={col.current === 0}
                  className="cursor-pointer rounded-[4px] border-0 bg-transparent px-1 py-[2px] font-semibold hover:text-ink disabled:cursor-not-allowed disabled:opacity-30"
                >
                  ‹ Prev
                </button>
                <span>{col.current + 1} of {col.totalPages}</span>
                <button
                  onClick={() => setColPage(col.status, col.current + 1)}
                  disabled={col.current >= col.totalPages - 1}
                  className="cursor-pointer rounded-[4px] border-0 bg-transparent px-1 py-[2px] font-semibold hover:text-ink disabled:cursor-not-allowed disabled:opacity-30"
                >
                  Next ›
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
