import { Chip, Dialog, FormSection, GhostButton } from '../../components/ui'
import { RailAside, RailClose, RailRow, RailSection } from '../../components/SummaryRail'
import { fmtCurrency, fmtDate, fmtLiters, fmtTerm, label } from '../../lib/format'
import { isInstallmentOverdue, type SupplierStat } from '../../lib/metrics'
import type { Purchase, SupplierQuote, Warehouse } from '../../data/types'

/** A purchase's payment badge summarized across its installments - collapses to a single
 * status when they all agree, otherwise "x/y paid" so a partial settlement isn't flattened
 * into one misleading chip. */
function installmentBadge(installments: Purchase['installments']) {
  const total = installments.length
  const paid = installments.filter((i) => i.status === 'paid').length
  const allCancelled = total > 0 && installments.every((i) => i.status === 'cancelled')
  const allPaid = total > 0 && paid === total
  const statusKey = allCancelled ? 'cancelled' : allPaid ? 'paid' : 'pending'
  const text = total > 1 && !allCancelled && !allPaid ? `${paid}/${total} paid` : label(statusKey)
  return { statusKey, text, anyOverdue: installments.some((i) => isInstallmentOverdue(i)) }
}

/** Neither side is `shrink-0`: a long address and a long label together used to
 *  push this wider than the dialog. */
function Row({ label: l, value }: { label: string; value: React.ReactNode }) {
  const empty = value === null || value === undefined || value === '' || value === '—'
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-linesoft py-[7px] text-[13px] last:border-b-0">
      <span className="min-w-0 font-meta text-[12px] text-mut">{l}</span>
      <span className="tnum min-w-0 break-words text-right font-semibold">
        {empty ? <span className="font-normal text-faint">Not recorded</span> : value}
      </span>
    </div>
  )
}

export default function SupplierDetail({ stat, purchases, quotes, warehouses, onClose }: {
  stat: SupplierStat | null
  purchases: Purchase[]
  quotes: SupplierQuote[]
  warehouses: Warehouse[]
  onClose: () => void
}) {
  if (!stat) return <Dialog open={false} title="" onClose={onClose}><span /></Dialog>
  const s = stat.supplier
  const depotName = (id: string) => warehouses.find((w) => w.id === id)?.name ?? '—'

  const recentQuotes = quotes
    .filter((q) => q.supplierId === s.id)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 6)

  const recentPurchases = purchases
    .filter((p) => p.supplierId === s.id)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 6)

  return (
    <Dialog
      open
      title={s.name}
      subtitle={[s.contactPerson, fmtTerm(s.paymentTermDays)].filter(Boolean).join(' · ')}
      aside={<Chip status="neutral" text={`Rank #${stat.rank}`} />}
      onClose={onClose}
      width={960}
      // What this supplier costs and how much of the business they hold - the
      // two things a buyer opens a supplier to check, previously the fifth and
      // sixth rows of a list.
      rail={
        <>
          <RailSection title="This period">
            <RailRow label="Purchases" value={stat.purchaseCount} />
            <RailRow label="Volume bought" value={fmtLiters(stat.totalVolume)} />
            <RailRow label="Share of spend" value={`${(stat.share * 100).toFixed(0)}%`} />
            <RailClose label="Total spend" value={fmtCurrency(stat.totalSpend).replace('.00', '')} />
          </RailSection>

          <RailSection title="Price">
            <RailRow label="Average quoted" value={stat.avgQuoted !== null ? `₱${stat.avgQuoted.toFixed(2)}/L` : '—'} />
            <RailRow label="Average paid" value={stat.avgPaid !== null ? `₱${stat.avgPaid.toFixed(2)}/L` : '—'} />
            {stat.lastQuote ? (
              <RailAside>
                Last quoted ₱{stat.lastQuote.pricePerLiter.toFixed(2)}/L on {fmtDate(stat.lastQuote.date)}.
              </RailAside>
            ) : (
              <RailAside>No quote on file.</RailAside>
            )}
          </RailSection>
        </>
      }
      footer={<GhostButton onClick={onClose}>Close</GhostButton>}
    >
      <FormSection first>Contact &amp; terms</FormSection>
      <div className="grid grid-cols-2 gap-x-5">
        <div className="min-w-0">
          <Row label="Contact person" value={s.contactPerson} />
          <Row label="Contact number" value={s.contactNumber} />
        </div>
        <div className="min-w-0">
          <Row label="Address" value={s.address} />
          <Row label="Payment terms" value={fmtTerm(s.paymentTermDays)} />
        </div>
      </div>

      <FormSection>Quote history</FormSection>
      <div className="overflow-hidden rounded-[8px] border border-line">
        <div className="grid grid-cols-[1fr_auto] items-center gap-3 border-b border-linesoft bg-paper px-[12px] py-[7px] font-meta text-[10px] font-semibold uppercase tracking-[.09em] text-faint">
          <span>Date</span>
          <span className="text-right">Quoted</span>
        </div>
        {recentQuotes.map((q) => (
          <div
            key={q.id}
            className="grid grid-cols-[1fr_auto] items-center gap-3 border-b border-linesoft px-[12px] py-[8px] text-[13px] last:border-b-0"
          >
            <span className="font-meta text-[12px] text-mut">{fmtDate(q.date).replace(', 2026', '')}</span>
            <span className="tnum text-right font-semibold">₱{q.pricePerLiter.toFixed(2)}/L</span>
          </div>
        ))}
        {recentQuotes.length === 0 && <p className="m-0 py-5 text-center text-[13px] text-faint">No quotes yet.</p>}
      </div>

      <FormSection>Purchase history</FormSection>
      <div className="overflow-hidden rounded-[8px] border border-line">
        <div className="grid grid-cols-[92px_1fr_92px_110px_auto] items-center gap-3 border-b border-linesoft bg-paper px-[12px] py-[7px] font-meta text-[10px] font-semibold uppercase tracking-[.09em] text-faint">
          <span>Date</span>
          <span>Volume</span>
          <span className="text-right">Price</span>
          <span>Depot</span>
          <span className="text-right">Status</span>
        </div>
        {recentPurchases.map((p) => {
          const badge = installmentBadge(p.installments)
          return (
            <div
              key={p.id}
              className="grid grid-cols-[92px_1fr_92px_110px_auto] items-center gap-3 border-b border-linesoft px-[12px] py-[8px] text-[13px] last:border-b-0"
            >
              <span className="font-meta text-[12px] text-mut">{fmtDate(p.date).replace(', 2026', '')}</span>
              <span className="tnum font-semibold">{fmtLiters(p.volumeLiters)}</span>
              <span className="tnum text-right text-lab">₱{p.pricePerLiter.toFixed(2)}/L</span>
              <span className="min-w-0 truncate font-meta text-[12px] text-mut">{depotName(p.warehouseId)}</span>
              <span className="flex flex-wrap items-center justify-end gap-[5px]">
                <Chip status={p.status} text={label(p.status)} />
                <Chip status={badge.statusKey} text={badge.text} />
                {badge.anyOverdue && <Chip status="overdue" text="Overdue" />}
              </span>
            </div>
          )
        })}
        {recentPurchases.length === 0 && <p className="m-0 py-5 text-center text-[13px] text-faint">No purchases yet.</p>}
      </div>
    </Dialog>
  )
}
