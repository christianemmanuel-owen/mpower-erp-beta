import { TEAL } from '../../lib/chartColors'
import { CreateAction } from '../../lib/quickCreate'
import { useToast } from '../../components/Toast'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpToLine, TriangleAlert } from 'lucide-react'
import { nanoid } from 'nanoid'
import { useTables } from '../../lib/data'
import { useAuth } from '../../lib/auth'
import StockThresholds from './StockThresholds'
import { PendingBanner } from '../settings/Approvals'
import { recordHref, usePendingRecord } from '../../lib/deepLink'
import { repos } from '../../data/repo'
import { stockValue, totalStockValue,
  type StockSeriesPoint,
  stockSeries,
  daysOfCover,
  warehouseFlow,
  stockMovements,
  billedVolume, inRange, isInstallmentOverdue, purchaseInstallmentEntries, receivedVolume, stockByWarehouse, volumeIn, volumeOut, purchaseInDate,
} from '../../lib/metrics'
import { RangePicker, useRange } from '../../lib/range'
import { useQuickCreate } from '../../lib/quickCreate'
import { compareValues, useSortableTable } from '../../lib/sort'
import { todayISO, addDaysISO, fmtCompactPeso, fmtCurrency, fmtDate, fmtLiters, fmtNum, fmtTerm, label } from '../../lib/format'
import { InfoTip, ExportButton, Card, Chip, DataTable, Dialog, Field, FormSection, Gauge, GhostButton, Input, KpiStrip, MiniDark, PageHeader, PrimaryButton, Select, filterCls, td } from '../../components/ui'
import { InstallmentEditor, installmentTotal, standardInstallmentPresets, type InstallmentRow } from '../../components/InstallmentEditor'
import { RailAside, RailClose, RailDelta, RailRow, RailSection, RailTotal } from '../../components/SummaryRail'
import { FormNav, useSectionNav, type FormNavSection } from '../../components/FormNav'
import DocumentUpload from '../../components/DocumentUpload'
import { allocateReference } from '../../lib/attachments'
import { isPending } from '../../lib/approvals'
import { exportTable } from '../../lib/exportXlsx'
import { hasCatalog, productName, productOptions } from '../../lib/products'
import { InlineNotice } from '../../components/Notice'
import PurchaseBoard from './PurchaseBoard'
import ReceiveDialog from './ReceiveDialog'
import type { BankAccount, Product, Purchase, PurchasePaymentStatus, Supplier, Warehouse } from '../../data/types'

const purchaseInstallmentStatusOptions = [
  { value: 'pending', label: 'Pending' },
  { value: 'paid', label: 'Paid' },
  { value: 'cancelled', label: 'Cancelled' },
]

/**
 * Stock, split into three subpages reached from the sidebar.
 *
 * It was one page carrying depot levels, headline figures, a movement ledger,
 * the purchases table, a kanban board and the warning-level editor, which meant
 * several screens of scrolling to reach anything below the fold. The data
 * loading and every derived figure stay shared - only the render is split - so
 * the subpages cannot disagree about what is in the tanks.
 */
/**
 * One depot's balance over the period.
 *
 * The ledger says what is in the tank now; this says whether it is filling or
 * draining, which the number on its own cannot answer.
 */
function DepotTrend({ series, warehouseId }: { series: StockSeriesPoint[]; warehouseId: string }) {
  const values = series.map((pt) => pt.values[warehouseId] ?? 0)
  if (values.length < 2) return <span className="font-meta text-[12px] text-faint">—</span>
  const max = Math.max(...values)
  const min = Math.min(...values)
  const span = max - min
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * 116
    // A depot that held steady has no range to scale against, so it draws down
    // the middle rather than dividing by zero or pinning flat to the floor.
    const y = span === 0 ? 13 : 24 - ((v - min) / span) * 20
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  const [lx, ly] = (pts[pts.length - 1] ?? '116,13').split(',')
  return (
    <svg viewBox="0 0 120 26" preserveAspectRatio="none" className="block h-[24px] w-[92px]" role="img" aria-hidden="true">
      <polyline
        fill="none" stroke={TEAL} strokeWidth={1.4}
        strokeLinejoin="round" strokeLinecap="round"
        vectorEffect="non-scaling-stroke" points={pts.join(' ')}
      />
      <circle cx={lx} cy={ly} r={2} fill={TEAL} />
    </svg>
  )
}

const PAGE_TITLES = { levels: 'Stock levels', purchases: 'Purchases', movements: 'Movements', warnings: 'Low supply warnings' } as const

export default function Inventory({ page = 'levels' }: { page?: 'levels' | 'purchases' | 'movements' | 'warnings' }) {
  const { range } = useRange()
  const quick = useQuickCreate()
  const [search, setSearch] = useState('')
  const [warehouseFilter, setWarehouseFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [fulfillmentFilter, setFulfillmentFilter] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editingPurchase, setEditingPurchase] = useState<Purchase | null>(null)
  /** The purchase whose delivery is being received - Exhibit A 1.2 asks for the
   * volume that actually arrived, which can differ from what was ordered. */
  const [receiving, setReceiving] = useState<Purchase | null>(null)
  /** Shown after a save that was parked for approval (Secondary Feature 2.1),
   * so "saved" is never implied for something that hasn't been posted. */
  const toast = useToast()
  const { seat } = useAuth()
  const [view, setView] = useState<'table' | 'board'>('table')
  const { sort, toggle: toggleSort } = useSortableTable()
  const [pendingRecord, clearPendingRecord] = usePendingRecord()

  useEffect(() => {
    if (quick.consume('purchase')) { setEditingPurchase(null); setFormOpen(true) }
  }, [quick])



  function openEdit(p: Purchase) {
    setEditingPurchase(p)
    setFormOpen(true)
  }
  function closeForm() {
    setFormOpen(false)
    setEditingPurchase(null)
  }

  const data = useTables(['purchases', 'sales', 'warehouses', 'suppliers', 'bankAccounts', 'products', 'customers', 'stockThresholds'] as const)
  if (!data) return null
  const { purchases, sales, warehouses, suppliers, bankAccounts, products, customers, stockThresholds } = data
  const showProduct = hasCatalog(products)

  const movements = stockMovements(purchases, sales, range)
  /** The warning level configured for a depot, or null when none is set. Used to
   * flag a depot in the ledger with the same rule the server alerts on. */
  const thresholdFor = (warehouseId: string): number | null => {
    const t = stockThresholds.find((x) => x.warehouseId === warehouseId && x.active !== false)
    return typeof t?.thresholdLiters === 'number' ? t.thresholdLiters : null
  }

  // Exhibit A 1.1 - see the note in Sales.tsx.
  if (pendingRecord) {
    const found = purchases.find((x) => x.id === pendingRecord)
    clearPendingRecord()
    if (found) { setEditingPurchase(found); setFormOpen(true) }
  }

  const supplierName = (id: string) => suppliers.find((s) => s.id === id)?.name ?? '—'
  const warehouseName = (id: string) => warehouses.find((w) => w.id === id)?.name.replace(' depot', '') ?? '—'
  const stock = stockByWarehouse(purchases, sales)
  const stockSer = stockSeries(purchases, sales, warehouses.map((w) => w.id), range)

  const shownMovements = movements.filter((m) => !warehouseFilter || m.warehouseId === warehouseFilter)
  /**
   * The stock level after each movement, for the Balance column.
   *
   * Only meaningful with a single depot selected: a running total across depots
   * would be a figure no tank ever actually held. `shownMovements` is
   * newest-first, so walking it forwards steps backwards in time - start from
   * today's level and undo each move as you go.
   */
  const balanceAfter = new Map<string, number>()
  if (warehouseFilter) {
    let running = Math.max(stock.get(warehouseFilter) ?? 0, 0)
    for (const m of shownMovements) {
      balanceAfter.set(m.id, running)
      running -= m.liters
    }
  }
  const totalStock = [...stock.values()].reduce((a, b) => a + b, 0)
  const vin = volumeIn(purchases, range)
  const vout = volumeOut(sales, range)
  const net = vin - vout

  const inRangeReceived = purchases.filter((p) => p.status === 'received' && inRange(purchaseInDate(p), range))
  // Both sides of the average run on DELIVERED volume, settled by Q13: MPower
  // pays for what arrived, so cost of goods is the delivered volume at the
  // agreed price. Using ordered volume here would overstate spend on every
  // short delivery - and would disagree with the installment plan, which
  // receiving now adjusts to match.
  const buyCost = inRangeReceived.reduce((s, p) => s + receivedVolume(p) * p.pricePerLiter, 0)
  const buyVol = inRangeReceived.reduce((s, p) => s + receivedVolume(p), 0)
  const awaiting = purchases.filter((p) => p.status === 'ordered').length
  // Summed from the same per-depot function the Value column prints, so the
  // total and the column can never disagree.
  const stockVal = totalStockValue(purchases, sales, warehouses.map((w) => w.id))

  const openInstallments = purchaseInstallmentEntries(purchases).filter((e) => e.installment.status === 'pending')
  const toPay = openInstallments.reduce((sum, e) => sum + e.installment.amount, 0)
  const overduePayable = openInstallments
    .filter((e) => isInstallmentOverdue(e.installment))
    .reduce((sum, e) => sum + e.installment.amount, 0)

  const sortAccessors: Record<string, (p: Purchase) => string | number> = {
    date: (p) => p.date,
    supplier: (p) => supplierName(p.supplierId),
    volume: (p) => p.volumeLiters,
    total: (p) => p.volumeLiters * p.pricePerLiter,
    payment: (p) => label(p.paymentMode),
    status: (p) => p.status,
  }
  const rows = purchases
    .filter((p) => inRange(p.date, range))
    .filter((p) => !warehouseFilter || p.warehouseId === warehouseFilter)
    .filter((p) => !statusFilter || p.status === statusFilter)
    .filter((p) => !fulfillmentFilter || p.fulfillment === fulfillmentFilter)
    .filter((p) => {
      if (!search) return true
      const q = search.toLowerCase()
      // PO numbers are allocated and shown in the table, and the global search
      // hint promises "purchases, suppliers" - matching only the supplier made
      // a PO number look like it returned nothing.
      return supplierName(p.supplierId).toLowerCase().includes(q)
        || (p.poReferenceNo ?? '').toLowerCase().includes(q)
    })
    .sort((a, b) => sort
      ? compareValues(sortAccessors[sort.key](a), sortAccessors[sort.key](b), sort.dir)
      : b.date.localeCompare(a.date))

  const headroom = (w: Warehouse) => w.capacityLiters - Math.max(stock.get(w.id) ?? 0, 0)
  const roomiest = [...warehouses].sort((a, b) => headroom(b) - headroom(a))[0]

  /** A kanban card is one installment, not one purchase - moving it updates just that entry
   * inside its parent purchase's installments array. */
  async function moveInstallment(purchaseId: string, installmentId: string, status: PurchasePaymentStatus) {
    const target = purchases.find((p) => p.id === purchaseId)
    if (!target) return
    const installments = target.installments.map((i) => (i.id === installmentId ? { ...i, status } : i))
    const result = await repos.purchases.update(purchaseId, { installments })
    // Without this a parked drag just bounces the card back with no explanation
    // - the same convention the purchase form and receive dialog already follow.
    if (isPending(result)) toast(result.message)
  }

  /** Table row summary across a purchase's installments - collapses to a single status/chip
   * when they all agree, otherwise shows "x/y paid" for a partially-settled plan. */
  function installmentBadge(installments: Purchase['installments']) {
    const total = installments.length
    const paid = installments.filter((i) => i.status === 'paid').length
    const allCancelled = total > 0 && installments.every((i) => i.status === 'cancelled')
    const allPaid = total > 0 && paid === total
    const statusKey = allCancelled ? 'cancelled' : allPaid ? 'paid' : 'pending'
    const text = total > 1 && !allCancelled && !allPaid ? `${paid}/${total} paid` : label(statusKey)
    return { statusKey, text, anyOverdue: installments.some((i) => isInstallmentOverdue(i)) }
  }

  /** Secondary Feature 2.12 - exports exactly what is on screen, filters and all,
   * so the spreadsheet matches what the user was looking at when they clicked. */
  function exportPurchases(list: Purchase[]) {
    exportTable(
      `purchases-${range.from.slice(0, 10)}-to-${range.to.slice(0, 10)}`,
      'Purchases',
      [
        'Date', 'PO reference', 'Supplier', 'Depot', 'Product', 'Fulfillment',
        'Volume ordered (L)', 'Volume received (L)', 'Price per liter', 'Total',
        'Payment mode', 'Status', 'Installments', 'Paid installments',
      ],
      list.map((p) => [
        p.date.slice(0, 10),
        p.poReferenceNo ?? '',
        supplierName(p.supplierId),
        warehouseName(p.warehouseId),
        productName(products, p.productId),
        p.fulfillment === 'delivered' ? 'Supplier delivery' : 'Company pickup',
        p.volumeLiters,
        p.status === 'received' ? p.volumeReceived ?? p.volumeLiters : null,
        p.pricePerLiter,
        billedVolume(p) * p.pricePerLiter,
        label(p.paymentMode),
        label(p.status),
        p.installments.length,
        p.installments.filter((i) => i.status === 'paid').length,
      ]),
    )
  }


  return (
    <>
      {/* Secondary Feature 2.1 - staff see their own parked inputs where they work. */}
      <PendingBanner tbl="purchases" />
      <PageHeader
        title={PAGE_TITLES[page]}
        // It was a filled Chip in the purchases toolbar, taking a slot in a row
        // of controls to report a number you cannot act on from there. Under
        // the title it is the first thing read, it costs no room in the
        // toolbar, and "Show them" does what looking at it makes you want to do
        // - the status filter it sets already existed, three controls away.
        subtitle={page === 'purchases' && awaiting > 0 ? (
          <InlineNotice
            action={statusFilter === 'ordered' ? undefined : 'Show'}
            onAction={() => { setStatusFilter('ordered'); setView('table') }}
          >
            {awaiting} purchase{awaiting === 1 ? '' : 's'} awaiting receipt
          </InlineNotice>
        ) : undefined}
        right={<><RangePicker /><CreateAction /></>}
      />


      {page === 'levels' && (
        <>
      <div className="mb-3">
        <KpiStrip
          items={[
            { label: 'Volume in', value: fmtLiters(vin) },
            { label: 'Volume out', value: fmtLiters(vout) },
            { label: 'Net change', value: `${net >= 0 ? '+' : ''}${fmtNum(net)} L` },
            { label: 'Avg buy price', value: buyVol > 0 ? `₱${(buyCost / buyVol).toFixed(2)}/L` : '—' },
            {
              label: (
                <span className="inline-flex items-center gap-[5px]">
                  Stock value
                  <InfoTip label="How the tanks are valued">
                    What the fuel standing in the tanks cost to buy: each depot's volume
                    at the weighted-average price of everything ever received there, then
                    added up. All-time on both sides, so it does not move with the date
                    range above - and it is weighted-average costing rather than FIFO, so
                    treat it as what the stock cost, not as a book value.
                    {stockVal.unpriced > 0 && ` ${stockVal.unpriced} depot${stockVal.unpriced === 1 ? '' : 's'} could not be priced and ${stockVal.unpriced === 1 ? 'is' : 'are'} left out.`}
                  </InfoTip>
                </span>
              ),
              value: stockVal.priced > 0 ? fmtCompactPeso(stockVal.total) : '—',
              sub: stockVal.unpriced > 0
                ? <span className="text-ambertext">{stockVal.priced} of {warehouses.length} depots priced</span>
                : <span>at average cost</span>,
            },
            { label: 'To pay', value: fmtCompactPeso(toPay), sub: <span className="font-semibold text-redtext">{fmtCompactPeso(overduePayable)} overdue</span> },
          ]}
        />
      </div>

      {/* Depot ledger - Exhibit A 1.2 asks for volume in and out "per warehouse
          and total", and the old capacity cards showed only a level. One row per
          depot, so the depots can be read down a column instead of compared
          across three separate cards. */}
      <Card className="mb-3 flex flex-col">
        <div className="flex flex-wrap items-center gap-[10px] border-b border-linesoft px-[14px] py-[10px]">
          <span className="text-[13px] font-semibold">Depots</span>
          <InfoTip label="Which columns move with the date range">
            On hand and Capacity are current, whatever range is selected. In, Out and
            Net are only what moved inside the range, so a narrow range can show a
            large stock beside almost no movement.
          </InfoTip>
          <span className="ml-auto font-meta text-[12px] text-mut">
            {fmtLiters(totalStock)} total
          </span>
        </div>
        <DataTable
          cols={[
            { label: '' },
            { label: 'Depot' },
            { label: 'On hand', align: 'right' },
            { label: 'Capacity', align: 'right' },
            { label: 'In', align: 'right' },
            { label: 'Out', align: 'right' },
            { label: 'Net', align: 'right' },
            {
              label: (
                <span className="inline-flex items-center gap-[5px]">
                  Value
                  <InfoTip label="What this depot's fuel cost">
                    On-hand volume at the weighted-average price of everything ever
                    received into this depot. A depot that has never taken a delivery
                    has no price to value it at and shows a dash rather than zero.
                  </InfoTip>
                </span>
              ),
              align: 'right',
            },
            { label: 'Trend' },
            {
              label: (
                <span className="inline-flex items-center gap-[5px]">
                  Cover
                  <InfoTip label="How days of cover is projected">
                    Stock on hand divided by the average daily outflow, where the
                    average is spread over the whole selected range - not over the days
                    that actually had trade. A range reaching into the future, or back
                    before this depot traded, therefore flatters the figure. A depot
                    with no outflow at all shows nothing rather than unlimited cover: a
                    quiet month is not proof a depot will never run dry.
                  </InfoTip>
                </span>
              ),
              align: 'right',
            },
          ]}
          empty="No depots set up yet."
        >
          {warehouses.map((w) => {
            const v = Math.max(stock.get(w.id) ?? 0, 0)
            // A depot with no capacity recorded would otherwise render NaN%.
            const pct = w.capacityLiters > 0 ? Math.round((v / w.capacityLiters) * 100) : null
            const near = pct !== null && pct >= 85
            const flow = warehouseFlow(purchases, sales, w.id, range)
            const cover = daysOfCover(purchases, sales, w.id, range)
            const value = stockValue(purchases, sales, w.id)
            const level = thresholdFor(w.id)
            const below = level !== null && v < level
            return (
              <tr key={w.id} className="hover:bg-fill2">
                {/* State as a mark rather than a sentence. The prose repeated
                    figures already in the row, and a depot in both states could
                    only ever show one of the two messages. */}
                <td className={`${td} w-[26px] pl-[14px] pr-0`}>
                  {below ? (
                    <TriangleAlert
                      size={15} strokeWidth={1.8} className="text-redtext"
                      aria-label={`Below its ${fmtLiters(level)} warning level`}
                    />
                  ) : near ? (
                    <ArrowUpToLine
                      size={15} strokeWidth={1.8} className="text-ambertext"
                      aria-label={`Near full${roomiest && roomiest.id !== w.id ? `, route the next purchase to ${roomiest.name.replace(' depot', '')}` : ''}`}
                    />
                  ) : null}
                </td>
                <td className={td}>
                  <p className="m-0 text-[13px] font-semibold">{w.name.replace(' depot', '')}</p>
                </td>
                <td className={`${td} text-right`}>
                  <p className="tnum m-0 text-[13px] font-semibold">{fmtLiters(v)}</p>
                </td>
                <td className={`${td} text-right`}>
                  <span className="flex flex-col items-end gap-[5px]">
                    <span className={`tnum font-meta text-[12px] ${near ? 'font-semibold text-ambertext' : 'text-mut'}`}>
                      {pct === null ? 'not set' : `${pct}%`}
                    </span>
                    {pct !== null && (
                      <span className="w-[72px]"><Gauge pct={pct} color={near ? 'bg-amber' : 'bg-faint'} /></span>
                    )}
                  </span>
                </td>
                <td className={`${td} tnum text-right text-[13px]`}>{flow.in > 0 ? fmtLiters(flow.in) : '—'}</td>
                <td className={`${td} tnum text-right text-[13px]`}>{flow.out > 0 ? fmtLiters(flow.out) : '—'}</td>
                <td className={`${td} tnum text-right text-[13px] font-semibold`}>
                  {flow.net === 0 ? '—' : `${flow.net > 0 ? '+' : ''}${fmtNum(flow.net)} L`}
                </td>
                <td className={`${td} tnum whitespace-nowrap text-right`}>
                  {value === null ? <span className="text-faint">—</span> : fmtCompactPeso(value)}
                </td>
                <td className={td}><DepotTrend series={stockSer} warehouseId={w.id} /></td>
                <td className={`${td} tnum whitespace-nowrap pr-[14px] text-right text-[13px]`}>
                  {cover === null ? (
                    <span className="font-meta text-[12px] text-faint">no sales</span>
                  ) : (
                    <span className={cover < 14 ? 'font-semibold text-redtext' : cover < 30 ? 'font-semibold text-ambertext' : 'text-lab'}>
                      {cover < 1 ? 'under a day' : `${Math.round(cover)} days`}
                    </span>
                  )}
                </td>
              </tr>
            )
          })}
        </DataTable>
      </Card>


        </>
      )}

      {/* Secondary Feature 2.3 - configuration only; the warning itself is
          raised server-side on the write that moves stock.

          Admin-only, and the sidebar hides the row for everyone else, but the
          check is repeated here because a hidden row is not access control -
          the URL is still typeable. The server refuses the writes regardless
          (see the stockThresholds guard in the API route). */}
      {page === 'warnings' && (
        seat?.isAdmin
          ? <StockThresholds onNotice={toast} />
          : (
            <Card className="p-[14px]">
              <p className="m-0 text-[13px] text-mut">
                Warning levels are set by an administrator.
              </p>
            </Card>
          )
      )}

      {/* Movements - Exhibit A 1.2, "volume out traced to the originating Sales
          or Logistics record". Derived, never stored, so it cannot drift from
          the purchases and sales it is built from.

          No card header: on its own subpage the PageHeader already says
          "Movements" and how many there are, and repeating it is just a second
          thing to read. */}
      {page === 'movements' && (
      <Card className="mb-3 flex flex-col">
        <DataTable
          cols={[
            { label: 'Date' },
            { label: 'Movement' },
            { label: 'Depot' },
            { label: 'Volume', align: 'right' },
            { label: 'Balance', align: 'right' },
          ]}
          empty={`Nothing moved in or out between ${fmtDate(range.from)} and ${fmtDate(range.to)}. Widen the date range to see earlier activity.`}
          pageSize={16}
          resetKey={`${range.from}-${range.to}-${warehouseFilter}`}
        >
          {shownMovements.map((m) => {
              const href = recordHref(m.tbl, m.recordId)
              const who = m.tbl === 'purchases'
                ? suppliers.find((x) => x.id === m.counterpartyId)?.name
                : customers.find((x) => x.id === m.counterpartyId)?.company
              const verb = m.kind === 'receipt' ? 'Received from' : m.kind === 'return' ? 'Returned by' : 'Sold to'
              return (
                <tr key={m.id} className="hover:bg-fill2">
                  <td className={`${td} pl-[14px] font-meta text-[12px] text-mut`}>{fmtDate(m.date)}</td>
                  <td className={td}>
                    <p className="m-0 text-[13px]">
                      {verb}{' '}
                      {href
                        ? <Link to={href} className="font-semibold text-lab hover:underline">{who ?? '—'}</Link>
                        : <span className="font-semibold">{who ?? '—'}</span>}
                    </p>
                  </td>
                  <td className={`${td} font-meta text-[12px] text-mut`}>
                    {warehouses.find((w) => w.id === m.warehouseId)?.name.replace(' depot', '') ?? '—'}
                  </td>
                  <td className={`${td} tnum text-right text-[13px] font-semibold ${m.liters < 0 ? 'text-lab' : 'text-teal'}`}>
                    {m.liters > 0 ? '+' : ''}{fmtNum(m.liters)} L
                  </td>
                  <td className={`${td} tnum whitespace-nowrap pr-[14px] text-right`}>
                    {balanceAfter.has(m.id) ? (
                      <span className="text-[13px] text-mut">{fmtLiters(balanceAfter.get(m.id)!)}</span>
                    ) : (
                      <span className="font-meta text-[12px] text-faint" title="Select a single depot to see a running balance">—</span>
                    )}
                  </td>
                </tr>
              )
            })}
        </DataTable>
      </Card>
      )}

      {page === 'purchases' && (
      <Card className="flex flex-col">
        <div className="flex flex-wrap items-center gap-[10px] border-b border-linesoft px-[14px] py-[10px]">
          <span className="flex gap-[2px] rounded-[6px] bg-fill2 p-[2px]">
            {(['table', 'board'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`cursor-pointer rounded-[4px] border-0 px-[11px] py-[3px] font-meta text-[12px] capitalize transition-colors ${
                  view === v ? 'bg-white font-semibold text-ink shadow-[0_1px_2px_rgba(20,24,27,.05)]' : 'bg-transparent text-mut hover:text-ink'
                }`}
              >
                {v}
              </button>
            ))}
          </span>
          {/* Sits beside the view switch so what it explains is unambiguous,
              and only in the view it is about. It was a caption under the
              board: a sentence permanently on screen to be read once. */}
          {view === 'board' && (
            <InfoTip label="How the payment board works">
              One card is one installment, not one purchase - a purchase paid in three parts
              appears as three cards. Drag a card between columns to change that installment's
              payment status.
            </InfoTip>
          )}
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Supplier or PO number…" className={`ml-auto w-[200px] ${filterCls}`} />
          <select value={warehouseFilter} onChange={(e) => setWarehouseFilter(e.target.value)} className={filterCls}>
            <option value="">All depots</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name.replace(' depot', '')}</option>)}
          </select>
          {view === 'table' && (
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={filterCls}>
              <option value="">All statuses</option>
              <option value="ordered">Ordered</option>
              <option value="received">Received</option>
            </select>
          )}
          <select value={fulfillmentFilter} onChange={(e) => setFulfillmentFilter(e.target.value)} className={filterCls}>
            <option value="">All fulfillment</option>
            <option value="delivered">Supplier delivery</option>
            <option value="pickup">Company pickup</option>
          </select>
          <ExportButton onClick={() => exportPurchases(rows)} />
        </div>
        {view === 'table' ? (
          <DataTable
            sort={sort}
            onSort={toggleSort}
            pageSize={10}
            resetKey={`${search}|${warehouseFilter}|${statusFilter}|${fulfillmentFilter}|${sort?.key}|${sort?.dir}|${range.from}|${range.to}`}
            cols={[
              { label: 'Date', sortKey: 'date' }, { label: 'Supplier', sortKey: 'supplier' }, { label: 'Volume', align: 'right', sortKey: 'volume' },
              { label: 'Total (₱/L)', align: 'right', sortKey: 'total' }, { label: 'Payment', sortKey: 'payment' }, { label: 'Status', sortKey: 'status' }, { label: '' },
            ]}
          >
            {rows.map((p) => (
              <tr key={p.id} className="hover:bg-hovrow">
                <td className={`${td} whitespace-nowrap pl-5 text-mut`}>{fmtDate(p.date)}</td>
                <td className={td}>
                  <p className="m-0 font-semibold">{supplierName(p.supplierId)}</p>
                  <p className="m-0 text-[12px] text-faint">
                    {p.fulfillment === 'delivered' ? 'Supplier delivery' : 'Company pickup'} · {warehouseName(p.warehouseId)}
                    {showProduct ? ` · ${productName(products, p.productId)}` : ''}
                  </p>
                  {p.poReferenceNo && <p className="m-0 text-[12px] text-faint">PO {p.poReferenceNo}</p>}
                </td>
                <td className={`${td} whitespace-nowrap text-right font-semibold`}>
                  {/* Exhibit A 1.2 - what arrived, when it differs from what was ordered.
                      Stock counts the received figure, so showing only the order would
                      explain the wrong number. */}
                  {p.status === 'received' && p.volumeReceived !== undefined && p.volumeReceived !== p.volumeLiters ? (
                    <>
                      <p className="m-0">{fmtLiters(p.volumeReceived)}</p>
                      <p className="m-0 text-[12px] font-normal text-faint">ordered {fmtLiters(p.volumeLiters)}</p>
                    </>
                  ) : (
                    fmtLiters(p.volumeLiters)
                  )}
                </td>
                <td className={`${td} whitespace-nowrap text-right`}>
                  {/* Costed on what arrived, matching the KPI strip, the export
                      and the installment re-spread. A short delivery is not
                      billed at the ordered volume. */}
                  <p className="m-0 font-semibold">{fmtCurrency(billedVolume(p) * p.pricePerLiter).replace('.00', '')}</p>
                  <p className="m-0 text-[12px] text-faint">₱{p.pricePerLiter.toFixed(2)}/L</p>
                </td>
                <td className={td}>
                  <p className="m-0 mb-[2px] text-mut">{label(p.paymentMode)}</p>
                  {(() => {
                    const badge = installmentBadge(p.installments)
                    return (
                      <span className="inline-flex flex-wrap items-center gap-[5px]">
                        <Chip status={badge.statusKey} text={badge.text} />
                        {badge.anyOverdue && <Chip status="overdue" text="Overdue" />}
                      </span>
                    )
                  })()}
                </td>
                <td className={td}><Chip status={p.status} text={label(p.status)} /></td>
                <td className={`${td} pr-5 text-right`}>
                  <span className="inline-flex items-center gap-3">
                    {p.status === 'ordered' && (
                      <MiniDark onClick={() => setReceiving(p)}>Mark received</MiniDark>
                    )}
                    {p.status === 'received' && (
                      <button
                        onClick={() => repos.purchases.update(p.id, {
                          status: 'ordered',
                          // Clear the whole receipt, not just the status. Leaving
                          // volumeReceived behind re-prefills the receive dialog
                          // with a figure nobody confirmed, and leaves an arrival
                          // date on a purchase that has not arrived.
                          volumeReceived: undefined,
                          receivedAt: undefined,
                        })}
                        className="cursor-pointer px-[2px] py-1 text-[11px] font-semibold uppercase text-faint hover:text-redtext hover:underline"
                      >
                        Revert
                      </button>
                    )}
                    <button onClick={() => openEdit(p)} className="cursor-pointer px-[2px] py-1 text-[11px] font-semibold uppercase text-tealtext hover:underline">Edit</button>
                  </span>
                </td>
              </tr>
            ))}
          </DataTable>
        ) : (
          <PurchaseBoard purchases={rows} supplierName={supplierName} warehouseName={warehouseName} onMove={moveInstallment} />
        )}
      </Card>
      )}

      <PurchaseForm
        open={formOpen} onClose={closeForm} editing={editingPurchase}
        suppliers={suppliers} warehouses={warehouses} bankAccounts={bankAccounts} headroom={headroom}
        products={products} showProduct={showProduct}
        onNotice={toast}
      />

      <ReceiveDialog
        purchase={receiving}
        onClose={() => setReceiving(null)}
        onNotice={toast}
      />
    </>
  )
}

function PurchaseForm({ open, onClose, editing, suppliers, warehouses, bankAccounts, headroom, products, showProduct, onNotice }: {
  open: boolean
  onClose: () => void
  editing: Purchase | null
  suppliers: Supplier[]
  warehouses: Warehouse[]
  bankAccounts: BankAccount[]
  headroom: (w: Warehouse) => number
  products: Product[]
  showProduct: boolean
  onNotice: (message: string) => void
}) {
  const [form, setForm] = useState(newPurchaseForm)
  const [allocating, setAllocating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showProblems, setShowProblems] = useState(false)
  // Every time the drawer opens, load the record being edited - or start from a genuinely
  // blank form for a new purchase (state used to persist across Cancel/reopen otherwise).
  useEffect(() => {
    if (!open) return
    setForm(editing ? purchaseToForm(editing) : newPurchaseForm())
    setError(null)
  }, [open, editing])
  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }))
  // The form takes the total price the supplier is charging; price per liter - the value
  // actually stored on the purchase, and what every other screen (Stock, Accounts, the price
  // chart) reads - is derived from it.
  const pricePerLiter = form.volumeLiters > 0 ? form.totalPrice / form.volumeLiters : 0

  // A purchase adds stock rather than consuming it, so the depot question is
  // whether it fits, not whether there is enough.
  const depot = warehouses.find((w) => w.id === form.warehouseId)
  const room = depot ? headroom(depot) : 0
  const overflows = !!depot && form.volumeLiters > room

  const planned = form.installments.reduce((sum, i) => sum + i.principal, 0)
  const unplanned = Math.round((form.totalPrice - planned) * 100) / 100

  const problems: Record<string, string> = {}
  if (!form.supplierId) problems.supplierId = 'Select a supplier.'
  if (!form.warehouseId) problems.warehouseId = 'Select the receiving depot.'
  if (form.volumeLiters <= 0) problems.volumeLiters = 'Enter the volume ordered.'
  if (form.totalPrice <= 0) problems.totalPrice = 'Enter the total price.'
  if (form.paymentMode === 'bank_transfer' && !form.bankAccountId) {
    problems.bankAccountId = 'Select the paying bank account.'
  }
  if (form.installments.length === 0) problems.installments = 'Add at least one payment entry.'
  else if (form.installments.some((i) => i.principal <= 0 || !i.dueDate)) {
    problems.installments = 'Each payment entry requires an amount and a due date.'
  }
  // Only after Save, so a form nobody has finished typing is not already red.
  const problem = (key: string) => (showProblems ? problems[key] : undefined)

  // The form's parts, for the nav. Each names the fields it owns so its mark is
  // derived rather than tracked separately.
  const SECTIONS: { id: string; title: string; keys: string[]; filled: () => boolean }[] = [
    { id: 'sec-what', title: 'Supplier & order', keys: ['supplierId', 'volumeLiters', 'totalPrice'], filled: () => !!form.supplierId && form.volumeLiters > 0 && form.totalPrice > 0 },
    { id: 'sec-po', title: 'PO reference', keys: [], filled: () => !!form.poReferenceNo },
    { id: 'sec-where', title: 'Delivery & storage', keys: ['warehouseId'], filled: () => !!form.warehouseId },
    { id: 'sec-payment', title: 'Payment', keys: ['bankAccountId'], filled: () => form.paymentMode !== 'bank_transfer' || !!form.bankAccountId },
    { id: 'sec-plan', title: 'Payment plan', keys: ['installments'], filled: () => form.installments.length > 0 && Math.abs(form.totalPrice - planned) < 0.01 },
  ]
  const navSections: FormNavSection[] = SECTIONS.map((sec) => ({
    id: sec.id,
    title: sec.title,
    state: sec.keys.some((k) => problem(k)) ? 'problem' : sec.filled() ? 'done' : 'todo',
  }))
  const { active, jump } = useSectionNav(SECTIONS.map((sec) => sec.id))

  const selectedSupplier = suppliers.find((s) => s.id === form.supplierId)
  // Automation: while the installment plan is still just the default single row, its due date
  // auto-fills from the supplier's own standing payment term (cash always settles same-day)
  // whenever the supplier, purchase date, or payment mode changes. A real multi-installment
  // plan (or editing an existing purchase) is left alone.
  useEffect(() => {
    if (editing || !open || !selectedSupplier || form.installments.length !== 1) return
    const due = form.paymentMode === 'cash' ? form.date : addDaysISO(form.date, selectedSupplier.paymentTermDays)
    setForm((f) => (f.installments.length !== 1 || f.installments[0].dueDate === due
      ? f
      : { ...f, installments: [{ ...f.installments[0], dueDate: due }] }))
  }, [form.supplierId, form.date, form.paymentMode, editing, open, selectedSupplier, form.installments.length])
  // Same convenience for the amount: a single default row's base amount tracks the total
  // price field.
  useEffect(() => {
    if (editing || !open || form.installments.length !== 1) return
    const amt = Math.round(form.totalPrice * 100) / 100
    setForm((f) => (f.installments.length !== 1 || f.installments[0].principal === amt
      ? f
      : { ...f, installments: [{ ...f.installments[0], principal: amt }] }))
  }, [form.totalPrice, editing, open, form.installments.length])

  /** Allocates the next number in the PO series (Exhibit A 1.2). A POST, so a
   * mis-click costs a number - hence the explicit button rather than allocating
   * on drawer open, which would burn one every time someone browsed the form. */
  async function getPoNumber() {
    setAllocating(true)
    try {
      set('poReferenceNo', await allocateReference('PO'))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t get a PO number.')
    } finally {
      setAllocating(false)
    }
  }

  async function save() {
    // Every problem at once, on the field it belongs to - this was seven
    // sequential guards that reported one failure at a time, in a banner at the
    // top rather than on the control that was wrong.
    setShowProblems(true)
    if (Object.keys(problems).length > 0) {
      setError(`${Object.keys(problems).length === 1 ? 'One field needs' : `${Object.keys(problems).length} fields need`} attention.`)
      return
    }
    const { totalPrice: _totalPrice, installments, productId, ...rest } = form
    const payload = {
      ...rest,
      // Blank means the default product - see src/lib/products.ts. Storing the
      // default id explicitly would work too, but keeping it blank means diesel
      // records look identical to the ones written before the catalog existed.
      productId: productId || undefined,
      pricePerLiter: Math.round(pricePerLiter * 100) / 100,
      date: new Date(form.date).toISOString(),
      bankAccountId: form.paymentMode === 'bank_transfer' ? form.bankAccountId : undefined,
      poReferenceNo: form.poReferenceNo || undefined,
      installments: installments.map((i) => ({
        id: i.id,
        principal: i.principal,
        interestPct: i.interestPct,
        amount: installmentTotal(i.principal, i.interestPct),
        dueDate: new Date(i.dueDate).toISOString(),
        status: i.status,
      })) as Purchase['installments'],
    }
    setError(null)
    try {
      const result = editing
        // Editing corrects the purchase's details only - each installment's own status is
        // edited in the installment rows, not reset wholesale by this form.
        ? await repos.purchases.update(editing.id, payload)
        : await repos.purchases.add(payload)

      // Secondary Feature 2.1 - the write may have been parked rather than
      // posted. Saying "saved" here would be a lie, and the purchase would be
      // missing from the table with no explanation.
      if (isPending(result)) onNotice(result.message)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t save this purchase.')
      return
    }
    setForm(newPurchaseForm())
    onClose()
  }

  return (
    <Dialog
      open={open}
      title={editing ? 'Edit purchase' : 'New purchase'}
      subtitle={suppliers.find((x) => x.id === form.supplierId)?.name}
      onClose={onClose}
      width={1100}
      nav={<FormNav sections={navSections} active={active} onJump={jump} />}
      rail={
        <>
          <RailSection title="This purchase">
            <RailRow label="Volume" value={form.volumeLiters > 0 ? `${fmtNum(form.volumeLiters)} L` : '—'} />
            <RailRow label="Price per litre" value={pricePerLiter > 0 ? `₱${pricePerLiter.toFixed(2)}` : '—'} />
            <RailTotal label="Total price" value={form.totalPrice > 0 ? fmtCurrency(form.totalPrice).replace('.00', '') : '—'} />
          </RailSection>

          {depot && (
            <RailSection title={depot.name}>
              {/* Room, not stock: this fuel is arriving, and the question a
                  buyer has is whether the tank can take it. */}
              <RailRow label="Room now" value={`${fmtNum(Math.max(room, 0))} L`} />
              <RailDelta label="This order" value={`${fmtNum(form.volumeLiters)} L`} sign="-" />
              <RailClose
                label="Room after"
                tone={overflows ? 'bad' : 'plain'}
                value={overflows
                  ? `${fmtNum(form.volumeLiters - room)} L over`
                  : `${fmtNum(Math.max(room - form.volumeLiters, 0))} L`}
              />
              {overflows && <RailAside tone="bad">Exceeds the capacity of {depot.name}.</RailAside>}
            </RailSection>
          )}

          {form.totalPrice > 0 && (
            <RailSection title="Payment plan">
              <RailRow label="Total price" value={fmtCurrency(form.totalPrice).replace('.00', '')} />
              <RailDelta label="Planned" value={fmtCurrency(planned).replace('.00', '')} sign="-" />
              <RailClose
                label={unplanned < 0 ? 'Over the total' : 'Left to plan'}
                tone={Math.abs(unplanned) < 0.01 ? 'plain' : 'bad'}
                value={fmtCurrency(Math.abs(unplanned)).replace('.00', '')}
              />
              {Math.abs(unplanned) >= 0.01 && (
                <RailAside tone="bad">
                  {unplanned > 0 ? 'Add an entry or increase an amount.' : 'Reduce an amount.'}
                </RailAside>
              )}
            </RailSection>
          )}
        </>
      }
      footer={
        <>
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton onClick={save}>{editing ? 'Save changes' : 'Save purchase'}</PrimaryButton>
        </>
      }
    >
      {error && (
        <p className="mb-3 rounded-[6px] border border-redf bg-redbadge px-3 py-2 text-[13px] font-semibold text-redtext">{error}</p>
      )}
      <FormSection first id="sec-what">Supplier &amp; order</FormSection>
      <div className="grid grid-cols-2 gap-x-4 gap-y-[14px]">
        <Field label="Supplier" span2 error={problem('supplierId')}>
          <Select value={form.supplierId} onChange={(e) => set('supplierId', e.target.value)}>
            <option value="" disabled>Select a supplier…</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        <Field label="Volume (L)" error={problem('volumeLiters')}>
          <Input type="number" min={1} placeholder="e.g. 10000" value={form.volumeLiters || ''} onChange={(e) => set('volumeLiters', Number(e.target.value))} />
        </Field>
        <Field label="Total price (₱)" error={problem('totalPrice')}>
          <Input type="number" step="0.01" min={0} placeholder="e.g. 520000" value={form.totalPrice || ''} onChange={(e) => set('totalPrice', Number(e.target.value))} />
        </Field>
        <Field label="Date" span2={!showProduct}>
          <Input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} />
        </Field>
        {/* Only shown once there is more than one product to pick - MPower trades
            diesel only today, so the form stays as short as it was. */}
        {showProduct && (
          <Field label="Product">
            <Select value={form.productId} onChange={(e) => set('productId', e.target.value)}>
              {productOptions(products).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
        )}
      </div>

      <FormSection id="sec-po">Purchase order reference</FormSection>
      <div className="grid grid-cols-2 gap-x-4 gap-y-[14px]">
        <Field label="PO reference number" hint="The number on the purchase order issued to the supplier.">
          <div className="flex gap-2">
            <Input
              value={form.poReferenceNo}
              placeholder="e.g. PO-2026-00041"
              onChange={(e) => set('poReferenceNo', e.target.value)}
            />
            <button
              type="button"
              disabled={allocating}
              onClick={getPoNumber}
              className="shrink-0 cursor-pointer rounded-[10px] border border-inputline bg-white px-3 text-[12px] font-semibold text-tealbtn hover:bg-fill2 disabled:opacity-50"
            >
              {allocating ? '…' : 'Get number'}
            </button>
          </div>
        </Field>
      </div>
      {/* Exhibit A 1.2 - "uploaded digital copy of the purchase order issued to
          the supplier". Uploads need a record to hang off, so a brand-new
          purchase has to be saved first; saying so beats a button that fails. */}
      {editing ? (
        <div className="mt-3">
          <DocumentUpload
            tbl="purchases"
            recordId={editing.id}
            slots={['supplierPo', 'supplierDeliveryReceipt', 'fuelAnalysisSlip']}
          />
        </div>
      ) : (
        <p className="mt-2 text-[12px] text-faint">
          Save the purchase first, then reopen it to attach the signed PO and delivery documents.
        </p>
      )}
      <FormSection id="sec-where">Delivery &amp; storage</FormSection>
      <div className="grid grid-cols-2 gap-x-4 gap-y-[14px]">
        <Field label="Fulfillment">
          <Select value={form.fulfillment} onChange={(e) => set('fulfillment', e.target.value)}>
            <option value="delivered">Supplier delivery</option>
            <option value="pickup">Company pickup</option>
          </Select>
        </Field>
        <Field label="Store in depot" error={problem('warehouseId')}>
          <Select value={form.warehouseId} onChange={(e) => set('warehouseId', e.target.value)}>
            <option value="" disabled>Select a depot…</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>{w.name} - {fmtNum(headroom(w))} L free</option>
            ))}
          </Select>
        </Field>
        {/* Exhibit A 1.2 asks for a delivery address alongside the fulfillment
            method. The field existed on the record and was written as '' by
            every save because nothing ever rendered it. Only meaningful when
            the supplier is bringing the fuel to us. */}
        {form.fulfillment === 'delivered' && (
          <Field
            label="Delivery address"
            span2
            hint="Where the supplier delivers. Leave blank to use the depot's own address."
          >
            <Input
              value={form.address}
              placeholder="e.g. Gate 3, Valenzuela depot, Karuhatan"
              onChange={(e) => set('address', e.target.value)}
            />
          </Field>
        )}
      </div>
      <FormSection id="sec-payment">Payment</FormSection>
      <div className="grid grid-cols-2 gap-x-4 gap-y-[14px]">
        <Field label="Payment" span2={form.paymentMode !== 'bank_transfer'}>
          <Select value={form.paymentMode} onChange={(e) => set('paymentMode', e.target.value)}>
            {/* Just the method. This used to append bankAccounts[0] - "Bank transfer -
                BDO 4521" - which named the first account in the list, not the one
                chosen. Next to a picker reading "Metrobank 1207" the form stated
                two different accounts for one payment, and the label was the
                wrong one. Which account it is, is the field beside this. */}
            <option value="bank_transfer">Bank transfer</option>
            <option value="cash">Cash</option>
            <option value="check">Check</option>
          </Select>
        </Field>
        {form.paymentMode === 'bank_transfer' && (
          <Field label="Pay from bank account" error={problem('bankAccountId')}>
            <Select value={form.bankAccountId} onChange={(e) => set('bankAccountId', e.target.value)}>
              <option value="" disabled>Select an account…</option>
              {bankAccounts.map((b) => <option key={b.id} value={b.id}>{b.bankName} {b.accountNumberMasked}</option>)}
            </Select>
          </Field>
        )}
      </div>
      <FormSection id="sec-plan">
        Payment plan
        {!editing && selectedSupplier && form.installments.length === 1 && (
          <span className="ml-2 text-[10.5px] font-normal normal-case tracking-normal text-faint">
            due date auto-fills from {selectedSupplier.name}'s {fmtTerm(selectedSupplier.paymentTermDays)} terms - add a row to split into installments
          </span>
        )}
      </FormSection>
      {problem('installments') && (
        <p className="m-0 mb-2 font-meta text-[12px] font-semibold text-redtext">{problem('installments')}</p>
      )}
      <InstallmentEditor
        rows={form.installments}
        onChange={(rows) => set('installments', rows)}
        statusOptions={purchaseInstallmentStatusOptions}
        totalPrice={form.totalPrice}
        presets={standardInstallmentPresets({
          date: form.date,
          totalPrice: form.totalPrice,
          termDays: selectedSupplier?.paymentTermDays,
          pendingStatus: purchaseInstallmentStatusOptions[0].value,
        })}
      />
    </Dialog>
  )
}

function newPurchaseForm() {
  return {
    supplierId: '',
    date: todayISO(),
    totalPrice: 0,
    volumeLiters: 0,
    fulfillment: 'delivered' as Purchase['fulfillment'],
    address: '',
    warehouseId: '',
    productId: '',
    poReferenceNo: '',
    status: 'ordered' as Purchase['status'],
    paymentMode: 'bank_transfer' as Purchase['paymentMode'],
    bankAccountId: '',
    installments: [
      {
        id: nanoid(8), principal: 0, interestPct: 0,
        dueDate: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10), status: 'pending',
      },
    ] as InstallmentRow[],
  }
}

/** Loads an existing purchase into the form shape - total price is derived back from the
 * stored price per liter, since that's what the form's "Total price" field takes as input. */
function purchaseToForm(p: Purchase) {
  return {
    supplierId: p.supplierId,
    date: p.date.slice(0, 10),
    totalPrice: Math.round(p.volumeLiters * p.pricePerLiter * 100) / 100,
    volumeLiters: p.volumeLiters,
    fulfillment: p.fulfillment,
    address: p.address ?? '',
    warehouseId: p.warehouseId,
    productId: p.productId ?? '',
    poReferenceNo: p.poReferenceNo ?? '',
    status: p.status,
    paymentMode: p.paymentMode,
    bankAccountId: p.bankAccountId ?? '',
    installments: p.installments.map((i): InstallmentRow => ({
      id: i.id, principal: i.principal, interestPct: i.interestPct, dueDate: i.dueDate.slice(0, 10), status: i.status,
    })),
  }
}
