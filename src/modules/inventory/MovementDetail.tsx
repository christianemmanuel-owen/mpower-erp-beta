import { Dialog, FormSection, GhostButton } from '../../components/ui'
import { RailAside, RailRow, RailSection } from '../../components/SummaryRail'
import { ModuleLink } from '../../components/ModuleLink'
import { recordHref } from '../../lib/deepLink'
import { fmtCurrency, fmtDate, fmtLiters, fmtNum, label } from '../../lib/format'
import { productName } from '../../lib/products'
import { TREATMENT_LABELS } from '../../lib/orderResolution'
import { cameBackToStock, returnedVolume, type StockMovement } from '../../lib/metrics'
import type { Customer, Product, Purchase, Sale, Supplier, Warehouse } from '../../data/types'

/**
 * One line of the movement ledger, opened: what moved, where, against which
 * sale or purchase, and the facts of that record a stock clerk would want
 * without leaving the ledger - price, reference numbers, who hauled it,
 * whether a return actually came back. The record itself is one click away
 * in the rail.
 */
export default function MovementDetail({ move, balanceAfter, sales, purchases, suppliers, customers, warehouses, products, onClose }: {
  move: StockMovement
  balanceAfter?: number
  sales: Sale[]
  purchases: Purchase[]
  suppliers: Supplier[]
  customers: Customer[]
  warehouses: Warehouse[]
  products: Product[]
  onClose: () => void
}) {
  const depot = warehouses.find((w) => w.id === move.warehouseId)
  const sale = move.tbl === 'sales' ? sales.find((s) => s.id === move.recordId) : undefined
  const purchase = move.tbl === 'purchases' ? purchases.find((p) => p.id === move.recordId) : undefined
  const supplier = purchase ? suppliers.find((s) => s.id === purchase.supplierId) : undefined
  const customer = sale ? customers.find((c) => c.id === sale.customerId) : undefined
  const who = supplier?.name ?? customer?.company ?? '—'
  const verb = move.kind === 'receipt' ? 'Received from' : move.kind === 'return' ? 'Returned by' : 'Sold to'
  const href = recordHref(move.tbl, move.recordId)
  const product = productName(products, sale?.productId ?? purchase?.productId, sale?.productLabel ?? purchase?.productLabel)

  return (
    <Dialog
      open
      title={`${verb} ${who}`}
      subtitle={`${move.liters > 0 ? '+' : ''}${fmtNum(move.liters)} L · ${depot?.name ?? 'depot'} · ${fmtDate(move.date)}`}
      onClose={onClose}
      width={720}
      rail={
        <>
          <RailSection title="Movement">
            <RailRow label="Date" value={fmtDate(move.date)} />
            <RailRow label="Direction" value={move.direction === 'in' ? 'Into the depot' : 'Out of the depot'} />
            <RailRow label="Volume" value={fmtLiters(Math.abs(move.liters))} />
            <RailRow label="Product" value={product} />
            <RailRow label="Depot" value={depot?.name.replace(' depot', '') ?? '—'} />
            {balanceAfter !== undefined && <RailRow label="Balance after" value={fmtLiters(balanceAfter)} />}
          </RailSection>
          {href ? (
            <RailAside>
              <span className="flex items-center justify-between gap-[8px]">
                <span>Open the {move.tbl === 'sales' ? 'sale' : 'purchase'}</span>
                <span onClick={onClose}><ModuleLink to={href} destination={move.tbl === 'sales' ? 'the sale' : 'the purchase'} /></span>
              </span>
            </RailAside>
          ) : null}
        </>
      }
      footer={<GhostButton onClick={onClose}>Close</GhostButton>}
    >
      {purchase && (
        <>
          <FormSection first>Purchase</FormSection>
          <Facts rows={[
            ['Supplier', supplier?.name ?? '—'],
            ['Ordered', `${fmtLiters(purchase.volumeLiters)} at ₱${purchase.pricePerLiter.toFixed(2)}/L`],
            ['Received', purchase.receivedAt ? `${fmtLiters(purchase.volumeReceived ?? purchase.volumeLiters)} on ${fmtDate(purchase.receivedAt)}` : 'Not yet received'],
            ['Total', fmtCurrency((purchase.volumeReceived ?? purchase.volumeLiters) * purchase.pricePerLiter)],
            ['Fulfillment', purchase.fulfillment === 'hauler' && purchase.hauler ? `Third-party hauler - ${purchase.hauler.name}${purchase.hauler.fee ? `, ${fmtCurrency(purchase.hauler.fee)} (${purchase.hauler.status})` : ''}` : label(purchase.fulfillment)],
            ['PO number', purchase.poReferenceNo ?? '—'],
            ['Payment', `${label(purchase.paymentMode)} · ${label(purchase.status)}`],
          ]} />
        </>
      )}
      {sale && (
        <>
          <FormSection first>Sale</FormSection>
          <Facts rows={[
            ['Customer', customer?.company ?? '—'],
            ['Order', `${fmtLiters(sale.volumeLiters)} at ₱${sale.pricePerLiter.toFixed(2)}/L`],
            ['Total', fmtCurrency(sale.volumeLiters * sale.pricePerLiter)],
            ['Fulfillment', label(sale.fulfillment)],
            ['Client PO', sale.clientPoReferenceNo ?? '—'],
            ['Payment', `${label(sale.paymentMode)} · ${label(sale.status)}`],
            ...(sale.status === 'returned' && sale.resolution ? [
              ['Return', `${fmtLiters(returnedVolume(sale))} returned on ${fmtDate(sale.resolution.date)} - ${sale.resolution.reason}`],
              ['Money', TREATMENT_LABELS[sale.resolution.treatment]],
              ['Fuel', cameBackToStock(sale) ? 'Came back into the depot' : 'Did not come back - a stock loss'],
            ] as [string, string][] : []),
          ]} />
        </>
      )}
      {!purchase && !sale && (
        <p className="m-0 font-meta text-[12px] text-mut">The record behind this movement is no longer on file.</p>
      )}
    </Dialog>
  )
}

function Facts({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="m-0 grid grid-cols-[140px_1fr] gap-x-[12px] gap-y-[7px] text-[13px]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="font-meta text-[12px] text-mut">{k}</dt>
          <dd className="m-0">{v}</dd>
        </div>
      ))}
    </dl>
  )
}
