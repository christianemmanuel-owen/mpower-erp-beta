import { useState } from 'react'
import { Chip } from '../../components/ui'
import { fmtCurrency, fmtDate, fmtLiters, label } from '../../lib/format'
import { isInstallmentOverdue, saleInstallmentEntries } from '../../lib/metrics'
import type { CollectionStatus, Customer, Sale } from '../../data/types'

// No colour per column: the heading already names the state.
const columns: { status: CollectionStatus; title: string }[] = [
  { status: 'pending', title: 'Pending' },
  { status: 'collected', title: 'Collected' },
  // Exhibit A 1.6 - a post-dated check that did not clear. Distinct from
  // cancelled: the money is still owed, the instrument just failed.
  { status: 'bounced', title: 'Bounced' },
  { status: 'cancelled', title: 'Cancelled' },
]

const pageSize = 5

/** Drag-and-drop board for individual sale installments (pending/collected/bounced/cancelled) - each
 * card is one installment, not one sale, so a 2-installment sale shows up as two cards, one per
 * due date. "Overdue" isn't a column - it's a badge computed from a pending card's due date.
 * Lived in Sales until the Collection module became the home for collection work. */
export default function CollectionBoard({ sales, customer, agentName, collectorName, onMove }: {
  sales: Sale[]
  customer: (id: string) => Customer | undefined
  agentName: (id: string) => string
  /** Resolved person in charge for a card, or null for unassigned. */
  collectorName: (sale: Sale, inst: Sale['installments'][number]) => string | null
  onMove: (saleId: string, installmentId: string, status: CollectionStatus) => void
}) {
  const [dragKey, setDragKey] = useState<string | null>(null)
  const [overCol, setOverCol] = useState<CollectionStatus | null>(null)
  const [page, setPage] = useState<Record<CollectionStatus, number>>({ pending: 0, collected: 0, bounced: 0, cancelled: 0 })

  // Drafts haven't been confirmed yet, so there's nothing to collect on them - same filter
  // saleInstallmentEntries already applies.
  const entries = saleInstallmentEntries(sales)
  const board = columns.map((col) => {
    const items = entries
      .filter((e) => e.installment.status === col.status)
      .sort((a, b) => b.sale.date.localeCompare(a.sale.date))
    const totalPages = Math.max(1, Math.ceil(items.length / pageSize))
    // Clamp instead of storing - so a column that shrinks (a card dragged out, a filter
    // narrowing the list) never gets stuck showing an empty page.
    const current = Math.min(page[col.status], totalPages - 1)
    return { ...col, items, totalPages, current, pageItems: items.slice(current * pageSize, current * pageSize + pageSize) }
  })

  function setColPage(status: CollectionStatus, p: number) {
    setPage((prev) => ({ ...prev, [status]: p }))
  }

  function drop(status: CollectionStatus) {
    if (dragKey) {
      const [saleId, installmentId] = dragKey.split('::')
      onMove(saleId, installmentId, status)
    }
    setDragKey(null)
    setOverCol(null)
  }

  return (
    <div className="p-4">
      <div className="grid grid-cols-4 items-start gap-4">
        {board.map((col) => (
          <div
            key={col.status}
            onDragOver={(e) => { e.preventDefault(); setOverCol(col.status) }}
            onDragLeave={() => setOverCol((c) => (c === col.status ? null : c))}
            onDrop={(e) => { e.preventDefault(); drop(col.status) }}
            className="rounded-[8px] transition-colors"
          >
            <div className="mb-2 flex items-baseline gap-2 border-b border-line pb-[6px]">
              <p className="m-0 truncate text-[13px] font-semibold">{col.title}</p>
              <span className="font-meta text-[12px] text-mut">{col.items.length}</span>
            </div>
            <div
              className={`flex min-h-[64px] flex-col gap-2 rounded-[6px] p-[2px] transition-colors ${
                overCol === col.status ? 'bg-fill2 outline-dashed outline-1 outline-inputline' : ''
              }`}
            >
              {col.pageItems.map(({ sale: s, installment: inst }) => {
                const c = customer(s.customerId)
                const key = `${s.id}::${inst.id}`
                const seq = s.installments.length > 1 ? s.installments.findIndex((x) => x.id === inst.id) + 1 : 0
                return (
                  <div
                    key={key}
                    draggable
                    onDragStart={(e) => { e.dataTransfer.setData('text/plain', key); setDragKey(key) }}
                    onDragEnd={() => { setDragKey(null); setOverCol(null) }}
                    className={`cursor-grab rounded-[6px] border border-line bg-white p-[10px] transition-colors hover:border-inputline active:cursor-grabbing ${dragKey === key ? 'opacity-40' : ''}`}
                  >
                    <div className="mb-[2px] flex items-baseline justify-between">
                      <span className="tnum text-[14px] font-semibold">{fmtCurrency(inst.amount).replace('.00', '')}</span>
                      <span className="tnum text-[11px] text-faint">{fmtDate(inst.dueDate).replace(', 2026', '')}</span>
                    </div>
                    <p className="m-0 text-[13px] font-semibold">{c?.company ?? '—'}</p>
                    <p className="m-0 text-[12px] text-mut">
                      {fmtLiters(s.volumeLiters)} · {agentName(s.agentId)}{seq > 0 ? ` · installment ${seq}/${s.installments.length}` : ''}
                    </p>
                    <div className="mt-[6px] flex items-center gap-[6px] text-[12px] text-mut">
                      <span>{label(s.paymentMode)}</span>
                      <span className="text-faint">· {collectorName(s, inst) ?? 'Unassigned'}</span>
                      {isInstallmentOverdue(inst) && <Chip status="overdue" text="Overdue" />}
                    </div>
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
      <p className="m-0 mt-3 text-[11px] text-faint">
        Drag a card between columns to update that installment's status · each card is one installment, not one sale · drafts aren't shown here
      </p>
    </div>
  )
}
