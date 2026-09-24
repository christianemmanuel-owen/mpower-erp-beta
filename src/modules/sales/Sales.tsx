import { useEffect, useState } from 'react'
import { CreateAction } from '../../lib/quickCreate'
import { useToast } from '../../components/Toast'
import { nanoid } from 'nanoid'
import { fetchTable, useTables } from '../../lib/data'
import { confirmSale, repos } from '../../data/repo'
import {
  agentStats, cameBackToStock, inRange, isInstallmentOverdue, revenue, stockOnDate, volumeOut,
  type DateRange,
} from '../../lib/metrics'
import { RangePicker, rangeDays, useRange } from '../../lib/range'
import { useQuickCreate } from '../../lib/quickCreate'
import { compareValues, useSortableTable } from '../../lib/sort'
import { todayISO, addDaysISO, fmtCurrency, fmtDate, fmtLiters, fmtNum, fmtTerm, label } from '../../lib/format'
import { bouncedFor, bouncedNote } from '../../lib/bouncedChecks'
import { ExportButton, Card, Chip, DataTable, Dialog, Field, FormSection, GhostButton, Input, KpiStrip, MiniDark, PageHeader, PrimaryButton, RowAction, Select, filterCls, td, WIDE_DIALOG, PageSkeleton } from '../../components/ui'
import { InstallmentEditor, installmentTotal, standardInstallmentPresets, type InstallmentRow } from '../../components/InstallmentEditor'
import { RailAside, RailClose, RailDelta, RailRow, RailSection, RailTotal } from '../../components/SummaryRail'
import { FormNav, useSectionNav, type FormNavSection } from '../../components/FormNav'
import DocumentUpload from '../../components/DocumentUpload'
import { TopAgentsCard } from '../dashboard/CashFlowCards'
import { PendingBanner } from '../settings/Approvals'
import { usePendingRecord } from '../../lib/deepLink'
import { isPending } from '../../lib/approvals'
import { exportTable } from '../../lib/exportXlsx'
import { hasCatalog, productName, productOptions } from '../../lib/products'
import { TREATMENT_LABELS, planRevertResolution } from '../../lib/orderResolution'
import ResolveOrderDialog from './ResolveOrderDialog'
import SalesTrend from './SalesTrend'
import { isSettled, wasCollected } from '../../lib/collectionStatus'
import type { Agent, BankAccount, Customer, Personnel, Product, Purchase, Sale, Warehouse } from '../../data/types'

const saleInstallmentStatusOptions = [
  { value: 'pending', label: 'Pending' },
  { value: 'collected', label: 'Collected' },
  { value: 'bounced', label: 'Bounced check' },
  { value: 'cancelled', label: 'Cancelled' },
]

function prevRange(range: DateRange): DateRange {
  const from = Date.parse(range.from)
  const to = Date.parse(range.to)
  const len = to - from + 86_400_000
  return { from: new Date(from - len).toISOString(), to: new Date(from - 86_400_000).toISOString() }
}

export default function Sales() {
  const { range } = useRange()
  const quick = useQuickCreate()
  const [search, setSearch] = useState('')
  const [agentFilter, setAgentFilter] = useState('')
  const [paymentFilter, setPaymentFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editingSale, setEditingSale] = useState<Sale | null>(null)
  /** The order being cancelled or returned, and which of the two it is. */
  const [resolving, setResolving] = useState<{ sale: Sale; kind: 'cancelled' | 'returned' } | null>(null)
  /** Shown when a write was parked for approval rather than posted (2.1). */
  const toast = useToast()
  const { sort, toggle: toggleSort } = useSortableTable()
  const [pendingRecord, clearPendingRecord] = usePendingRecord()

  useEffect(() => {
    if (quick.consume('sale')) { setEditingSale(null); setFormOpen(true) }
  }, [quick])



  function openEdit(s: Sale) {
    setEditingSale(s)
    setFormOpen(true)
  }
  function closeForm() {
    setFormOpen(false)
    setEditingSale(null)
  }

  const data = useTables(['sales', 'purchases', 'agents', 'customers', 'warehouses', 'bankAccounts', 'personnel', 'products', 'deliveries'] as const)
  if (!data) return <PageSkeleton />
  const { sales, purchases, agents, customers, warehouses, bankAccounts, personnel, products, deliveries } = data
  const showProduct = hasCatalog(products)

  // Exhibit A 1.1 - a dashboard click lands here with the record to open. Done
  // in the render body rather than an effect so it runs once the data is
  // actually loaded; see usePendingRecord.
  if (pendingRecord) {
    const found = sales.find((x) => x.id === pendingRecord)
    clearPendingRecord()
    if (found) { setEditingSale(found); setFormOpen(true) }
  }

  const agentName = (id: string) => agents.find((a) => a.id === id)?.name ?? '—'
  const customer = (id: string) => customers.find((c) => c.id === id)

  const periodSales = sales.filter((s) => inRange(s.date, range))
  const drafts = sales.filter((s) => s.status === 'draft').length
  const sold = volumeOut(sales, range)
  const rev = revenue(sales, range)
  const prevSold = volumeOut(sales, prevRange(range))
  const delta = prevSold > 0 ? ((sold - prevSold) / prevSold) * 100 : null
  const days = rangeDays(range)

  const sortAccessors: Record<string, (s: Sale) => string | number> = {
    date: (s) => s.date,
    customer: (s) => customer(s.customerId)?.company ?? '',
    agent: (s) => agentName(s.agentId),
    volume: (s) => s.volumeLiters,
    total: (s) => s.volumeLiters * s.pricePerLiter,
    payment: (s) => label(s.paymentMode),
    status: (s) => s.status,
  }
  const rows = periodSales
    .filter((s) => !agentFilter || s.agentId === agentFilter)
    .filter((s) => !paymentFilter || s.paymentMode === paymentFilter)
    .filter((s) => !statusFilter || s.status === statusFilter)
    .filter((s) => !search || (customer(s.customerId)?.company ?? '').toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => sort
      ? compareValues(sortAccessors[sort.key](a), sortAccessors[sort.key](b), sort.dir)
      : b.date.localeCompare(a.date))

  async function confirm(s: Sale) {
    const c = customer(s.customerId)
    // The delivery contact point (1.4) is the right source when the customer
    // has one; the flat legacy fields are the fallback for records written
    // before it existed.
    const result = await confirmSale(s, {
      address: s.deliveryAddress ?? c?.delivery?.address ?? c?.address ?? '',
      contactPerson: s.contactPerson ?? c?.delivery?.contactPerson ?? c?.contactPerson ?? '',
      contactNumber: s.contactNumber ?? c?.delivery?.contactNumber ?? c?.contactNumber ?? '',
    })
    // Confirm is the primary action on this page, and under the default
    // approval rules it is exactly the kind of write that gets parked. Dropping
    // the result meant the row simply stayed a draft with no explanation.
    if (isPending(result)) toast(result.message)
  }

  /** Manually closes out a confirmed sale. Delivery sales normally reach this automatically
   * when their trip is marked delivered in Logistics - this covers pickup sales (which have
   * no delivery to track) and any confirmed sale someone wants to close out by hand. */
  async function markFulfilled(s: Sale) {
    const result = await repos.sales.update(s.id, { status: 'fulfilled' })
    if (isPending(result)) toast(result.message)
  }

  /** Corrects a wrong click rather than modeling a real business "undo": fulfilled steps back
   * to confirmed with nothing else touched, but confirmed stepping back to draft also removes
   * the delivery trip confirming created - a draft sale shouldn't have a delivery sitting in
   * Logistics against it. */
  async function revertStatus(s: Sale) {
    // A cancelled or returned order goes back to whatever it was before, and the
    // installments the resolution cancelled become payable again. Without this
    // branch the Revert button was visible on those rows and did nothing at all.
    if (s.status === 'cancelled' || s.status === 'returned') {
      const result = await repos.sales.update(s.id, planRevertResolution(s))
      if (isPending(result)) toast(result.message)
    } else if (s.status === 'fulfilled') {
      const result = await repos.sales.update(s.id, { status: 'confirmed' })
      if (isPending(result)) toast(result.message)
    } else if (s.status === 'confirmed') {
      const result = await repos.sales.update(s.id, { status: 'draft' })
      if (isPending(result)) {
        // The sale is still confirmed, so its trip must stay. Removing it here
        // regardless left a confirmed order with no delivery behind it, which
        // is the orphan state the create path goes out of its way to avoid.
        toast(result.message)
        return
      }
      const existing = (await fetchTable('deliveries')).find((d) => d.saleId === s.id)
      if (existing) {
        const removal = await repos.deliveries.remove(existing.id)
        if (isPending(removal)) toast(removal.message)
      }
    }
  }


  /** Table row summary across a sale's installments - collapses to a single status/chip when
   * they all agree, otherwise shows "x/y collected" so a partially-settled plan doesn't get
   * misreported as one flat status. */
  function installmentBadge(installments: Sale['installments']) {
    const total = installments.length
    // Paid means cleared. A check in hand or at the bank is neither paid nor
    // still to be collected, so a plan with one of those reads as in flight
    // rather than flattening to either.
    const paid = installments.filter((i) => isSettled(i.status)).length
    const inFlight = installments.filter((i) => wasCollected(i.status) && !isSettled(i.status)).length
    const allCancelled = total > 0 && installments.every((i) => i.status === 'cancelled')
    const allPaid = total > 0 && paid === total
    const statusKey = allCancelled ? 'cancelled' : allPaid ? 'cleared' : inFlight > 0 && paid + inFlight === total ? 'deposited' : 'pending'
    const text = allCancelled ? label('cancelled')
      : allPaid ? label('cleared')
        : total > 1 ? `${paid}/${total} cleared${inFlight ? ` · ${inFlight} in flight` : ''}`
          : inFlight ? 'In flight' : label('pending')
    return { statusKey, text, anyOverdue: installments.some((i) => isInstallmentOverdue(i)) }
  }

  /** The DR number on the trip this sale created, once dispatch typed it. */
  const drNumberOf = (s: Sale) => deliveries.find((d) => d.saleId === s.id)?.documents?.deliveryReceipt?.referenceNo
  /** Cash, COD, or the credit term - from the sale's own term when it has
   *  one, else read off how far the last due date sits from the sale date. */
  const termsOf = (s: Sale) => {
    // Cash is already named as the mode beside this; saying it twice reads
    // as two different facts that happen to agree.
    if (s.paymentMode === 'cash') return null
    if (s.termDays !== undefined) return fmtTerm(s.termDays)
    const last = s.installments.reduce((m, i) => (i.dueDate > m ? i.dueDate : m), '')
    if (!last) return '—'
    const days = Math.round((Date.parse(last) - Date.parse(s.date)) / 86_400_000)
    return fmtTerm(Math.max(days, 0))
  }

  /** Secondary Feature 2.12 - exports exactly what is filtered on screen. */
  function exportSales(list: Sale[]) {
    exportTable(
      `sales-${range.from.slice(0, 10)}-to-${range.to.slice(0, 10)}`,
      'Sales',
      [
        'Date', 'Client PO', 'Customer', 'Agent', 'Depot', 'Product', 'Fulfillment',
        'Scheduled', 'Volume (L)', 'Price per liter', 'Total', 'Payment mode', 'Status',
        'Reason', 'Treatment', 'Volume returned (L)', 'Back in stock',
      ],
      list.map((s) => [
        s.date.slice(0, 10),
        s.clientPoReferenceNo ?? '',
        customer(s.customerId)?.company ?? '',
        agentName(s.agentId),
        warehouses.find((w) => w.id === s.warehouseId)?.name ?? '',
        productName(products, s.productId),
        label(s.fulfillment),
        s.scheduleDate ? `${s.scheduleDate.slice(0, 10)}${s.scheduleTime ? ` ${s.scheduleTime}` : ''}` : '',
        s.volumeLiters,
        s.pricePerLiter,
        s.volumeLiters * s.pricePerLiter,
        label(s.paymentMode),
        label(s.status),
        s.resolution?.reason ?? '',
        s.resolution ? TREATMENT_LABELS[s.resolution.treatment] : '',
        s.resolution?.volumeReturned ?? null,
        s.status === 'returned' ? (cameBackToStock(s) ? 'Yes' : 'No') : '',
      ]),
    )
  }


  return (
    <>
      {/* Secondary Feature 2.1 - staff see their own parked inputs where they work. */}
      <PendingBanner tbl="sales" />
      <PageHeader
        title="Sales"
        right={<><RangePicker /><CreateAction /></>}
      />

      <div className="mb-[18px] grid grid-cols-[2fr_1.2fr] items-stretch gap-[18px]">
        <div className="flex flex-col gap-[18px]">
        <KpiStrip
          delay={50}
          items={[
            {
              label: 'Volume sold',
              tip: {
                label: 'Volume sold',
                body: (
                  <>
                    Net litres sold, counted on the sale date. An order counts once it is
                    confirmed against the client&rsquo;s PO - the sale is made then, whether
                    or not the fuel has left the depot. Drafts and cancelled orders count
                    as nothing; a returned order comes off in full (or by the volume
                    returned), whatever was done about the money. Stock on hand is a
                    separate figure and is not this one. The arrow compares this figure
                    with the same figure for the {days} day{days === 1 ? '' : 's'} before that.
                  </>
                ),
              },
              value: fmtLiters(sold),
              sub: delta !== null && (
                <span className={`font-semibold ${delta >= 0 ? 'text-teal' : 'text-redtext'}`}>
                  {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}%
                </span>
              ),
            },
            {
              label: 'Net sales',
              tip: {
                label: 'Net sales',
                body: (
                  <>
                    Sales less returns, in pesos: each order&rsquo;s volume times its
                    agreed price, with returned orders taken off in full.
                    <br /><br />
                    The average underneath is <b>net sales ÷ volume sold</b> - this
                    figure divided by the Volume sold tile to the left. Both cover the
                    same orders, so the two always agree. It is not an average of the
                    per-sale prices, which would weight a 200-litre sale the same as a
                    20,000-litre one.
                  </>
                ),
              },
              value: fmtCurrency(rev),
              // The figure, not the working: how it is arrived at is in the
              // tooltip beside the label, where every other explanation lives.
              sub: <span>{sold > 0 ? `₱${(rev / sold).toFixed(2)}/L average` : 'No volume sold in the period'}</span>,
            },
            { label: 'Drafts', value: fmtNum(drafts), sub: <span>waiting to confirm</span> },
          ]}
        />
        <SalesTrend sales={sales} range={range} />
        </div>
        {/* The dashboard's card, not a second implementation of it.
            This one coloured its bar red below half quota and amber below
            eighty, which reads as an emergency on the third of the month and
            contradicts the rule the rest of the app follows: amber is watch,
            red is act now. It also showed a percentage with no volume beside
            it, and ranked five agents at 0% as though that were a ranking when
            nobody had sold anything in the period. */}
        <TopAgentsCard
          stats={agentStats(agents, sales, range)}
        />
      </div>

      <Card delay={150}>
        <div className="flex flex-wrap items-center gap-[10px] border-b border-linesoft px-[14px] py-[10px]">
          <span className="text-[13px] font-semibold">Transactions</span>
          <span className="font-meta text-[12px] text-mut">{rows.length}</span>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter by customer…" className={`ml-auto w-[200px] ${filterCls}`} />
          <select value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)} className={filterCls}>
            <option value="">All agents</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <select value={paymentFilter} onChange={(e) => setPaymentFilter(e.target.value)} className={filterCls}>
            <option value="">All payments</option>
            <option value="cash">Cash</option>
            <option value="check">Check</option>
            <option value="bank_transfer">Bank transfer</option>
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={filterCls}>
            <option value="">All statuses</option>
            <option value="draft">Draft</option>
            <option value="confirmed">Confirmed</option>
            <option value="fulfilled">Fulfilled</option>
            <option value="cancelled">Cancelled</option>
            <option value="returned">Returned</option>
          </select>
          <ExportButton onClick={() => exportSales(rows)} />
        </div>
        <DataTable
            sort={sort}
            onSort={toggleSort}
            pageSize={10}
            resetKey={`${search}|${agentFilter}|${paymentFilter}|${statusFilter}|${sort?.key}|${sort?.dir}|${range.from}|${range.to}`}
            cols={[
              { label: 'Date', sortKey: 'date' }, { label: 'Customer', sortKey: 'customer' }, { label: 'Agent', sortKey: 'agent' },
              { label: 'Order', align: 'right', sortKey: 'total' }, { label: 'Fulfilment' }, { label: 'Payment', sortKey: 'payment' },
              { label: 'Status', sortKey: 'status' }, { label: '' },
            ]}
          >
            {rows.map((s) => (
              <tr key={s.id} className="hover:bg-hovrow">
                <td className={`${td} whitespace-nowrap pl-5 text-mut`}>{fmtDate(s.date)}</td>
                <td className={td}>
                  <p className="m-0 font-semibold">{customer(s.customerId)?.company ?? '—'}</p>
                  {s.clientPoReferenceNo && <p className="m-0 text-[12px] text-sec">PO {s.clientPoReferenceNo}</p>}
                  {(() => { const n = bouncedNote(bouncedFor(s.customerId, sales)); return n ? <p className="m-0 mt-[2px]"><Chip status="overdue" text="Bounced checks" /></p> : null })()}
                </td>
                <td className={`${td} text-sec`}>{agentName(s.agentId)}</td>
                {/* Volume, price and total together, as one figure read down:
                    the litres, what each cost, what that comes to. Secondary
                    lines are a shade lighter, not faded out. */}
                <td className={`${td} whitespace-nowrap text-right`}>
                  <p className="tnum m-0 text-sec">{fmtLiters(s.volumeLiters)}</p>
                  <p className="tnum m-0 text-sec">₱{s.pricePerLiter.toFixed(2)}/L</p>
                  <p className="tnum m-0 font-semibold text-ink">{fmtCurrency(s.volumeLiters * s.pricePerLiter)}</p>
                </td>
                <td className={td}>
                  <p className="m-0">{s.fulfillment === 'delivery' ? 'Delivery' : 'Customer pickup'}</p>
                  <p className="m-0 text-[12px] text-sec">
                    {s.invoiceNo ? `Invoice ${s.invoiceNo}` : 'No invoice yet'}
                    {' · '}
                    {drNumberOf(s) ? `DR ${drNumberOf(s)}` : s.fulfillment === 'delivery' ? 'No DR yet' : 'No DR'}
                  </p>
                  {showProduct && <p className="m-0 text-[12px] text-sec">{productName(products, s.productId)}</p>}
                </td>
                <td className={td}>
                  <p className="m-0 mb-[2px]">{label(s.paymentMode)}{termsOf(s) ? ` · ${termsOf(s)}` : ''}</p>
                  {(() => {
                    const badge = installmentBadge(s.installments)
                    return (
                      <span className="inline-flex flex-wrap items-center gap-[5px]">
                        <Chip status={badge.statusKey} text={badge.text} />
                        {badge.anyOverdue && <Chip status="overdue" text="Overdue" />}
                        {s.installments.some((i) => i.status === 'bounced') && <Chip status="overdue" text="Bounced" />}
                      </span>
                    )
                  })()}
                </td>
                <td className={td}>
                  <Chip status={s.status} text={label(s.status)} />
                  {/* Exhibit A 1.3 - the reason travels with the order, not just
                      into a report nobody opens. */}
                  {s.resolution && (
                    <p className="m-0 mt-[3px] max-w-[190px] text-[12px] text-faint" title={s.resolution.reason}>
                      {TREATMENT_LABELS[s.resolution.treatment]}{s.status === 'returned' ? (cameBackToStock(s) ? ' · back in stock' : ' · fuel not returned') : ''} - {s.resolution.reason}
                    </p>
                  )}
                </td>
                <td className={`${td} pr-5 text-right`}>
                  <span className="inline-flex items-center gap-[4px]">
                    {s.status === 'draft' && <MiniDark onClick={() => confirm(s)}>Confirm</MiniDark>}
                    {s.status === 'confirmed' && <MiniDark onClick={() => markFulfilled(s)}>Mark fulfilled</MiniDark>}
                    {/* Exhibit A 1.3 - cancelled and returned orders, with reason
                        and treatment. Cancelling applies before the fuel moves;
                        returning applies after, which is why a fulfilled order
                        offers Return and an unfulfilled one offers Cancel. */}
                    {(s.status === 'draft' || s.status === 'confirmed') && (
                      <RowAction verb="cancel" label="Cancel this order" onClick={() => setResolving({ sale: s, kind: 'cancelled' })} />
                    )}
                    {s.status === 'fulfilled' && (
                      <RowAction verb="return" label="Record a return of this order" onClick={() => setResolving({ sale: s, kind: 'returned' })} />
                    )}
                    {/* The tooltip says exactly where the order goes back to,
                        because "revert" on its own next to "return" is a coin toss. */}
                    {s.status !== 'draft' && (
                      <RowAction
                        verb="revert"
                        label={
                          s.status === 'fulfilled' ? 'Undo fulfilment - back to confirmed'
                            : s.status === 'confirmed' ? 'Undo confirmation - back to draft'
                            : s.status === 'returned' ? 'Undo the return - back to fulfilled'
                            : 'Undo the cancellation - back to where it was'
                        }
                        onClick={() => revertStatus(s)}
                      />
                    )}
                    <RowAction verb="edit" label="Edit sale" onClick={() => openEdit(s)} />
                  </span>
                </td>
              </tr>
            ))}
          </DataTable>
      </Card>

      <SaleForm
        open={formOpen} onClose={closeForm} editing={editingSale}
        agents={agents} customers={customers} warehouses={warehouses} bankAccounts={bankAccounts}
        personnel={personnel} purchases={purchases} sales={sales}
        products={products} showProduct={showProduct}
        onNotice={toast}
      />

      <ResolveOrderDialog
        sale={resolving?.sale ?? null}
        kind={resolving?.kind ?? 'cancelled'}
        onClose={() => setResolving(null)}
        onNotice={toast}
      />
    </>
  )
}

export function SaleForm({ open, onClose, editing, agents, customers, warehouses, bankAccounts, personnel, purchases, sales, products, showProduct, onNotice, readOnly = false }: {
  /** Shown to a seat that may look but not change it - a treasurer opening
   *  a sale from the deposit queue. Every control is disabled and the footer
   *  only closes; the server refuses the edit anyway (foreignFieldProblem). */
  readOnly?: boolean
  open: boolean
  onClose: () => void
  editing: Sale | null
  agents: Agent[]
  customers: Customer[]
  warehouses: Warehouse[]
  bankAccounts: BankAccount[]
  personnel: Personnel[]
  purchases: Purchase[]
  sales: Sale[]
  products: Product[]
  showProduct: boolean
  onNotice: (message: string) => void
}) {
  const [form, setForm] = useState(newSaleForm)
  const [confirmNow, setConfirmNow] = useState(true)
  const [overrideStock, setOverrideStock] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showProblems, setShowProblems] = useState(false)
  // Every time the drawer opens, load the record being edited - or start from a genuinely
  // blank form for a new sale (state used to persist across Cancel/reopen otherwise).
  useEffect(() => {
    if (!open) return
    setForm(editing ? saleToForm(editing, customers.find((c) => c.id === editing.customerId)) : newSaleForm())
    setConfirmNow(true)
    setOverrideStock(false)
    setShowProblems(false)
    setError(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing])
  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }))

  const selectedCustomer = customers.find((c) => c.id === form.customerId)
  const activePersonnel = personnel.filter((p) => p.active !== false)

  // Picking a customer fills in who receives the fuel and where, from the
  // customer's card - editable after, because this order may go somewhere
  // else. Only on a new sale, and only when the customer changes.
  const pickCustomer = (id: string) => {
    const c = customers.find((x) => x.id === id)
    setForm((f) => ({
      ...f,
      customerId: id,
      contactPerson: c?.delivery?.contactPerson ?? c?.contactPerson ?? '',
      contactNumber: c?.delivery?.contactNumber ?? c?.contactNumber ?? '',
      deliveryAddress: c?.delivery?.address ?? c?.address ?? '',
      // The customer's standing term is the default; cash stays cash.
      termDays: f.paymentMode === 'cash' ? 0 : (c?.paymentTermDays ?? f.termDays),
    }))
  }

  // Volume times the price per litre is the total - typed once, computed
  // once, never two numbers that can disagree.
  const totalPrice = Math.round(form.volumeLiters * form.pricePerLiter * 100) / 100

  // Automation: while the installment plan is still just the default single row (the common
  // case), its due date auto-fills from the chosen terms (cash settles same-day) whenever the
  // sale date, terms or payment mode change. The moment someone builds out a real
  // multi-installment plan (or is editing an existing sale), their entries are left alone.
  useEffect(() => {
    if (editing || !open || form.installments.length !== 1) return
    const due = form.paymentMode === 'cash' ? form.date : addDaysISO(form.date, form.termDays)
    setForm((f) => (f.installments.length !== 1 || f.installments[0].dueDate === due
      ? f
      : { ...f, installments: [{ ...f.installments[0], dueDate: due }] }))
  }, [form.date, form.paymentMode, form.termDays, editing, open, form.installments.length])
  // Same convenience for the amount: a single default row's base amount tracks the total so
  // the common one-payment case never needs the number typed twice.
  useEffect(() => {
    if (editing || !open || form.installments.length !== 1) return
    setForm((f) => (f.installments.length !== 1 || f.installments[0].principal === totalPrice
      ? f
      : { ...f, installments: [{ ...f.installments[0], principal: totalPrice }] }))
  }, [totalPrice, editing, open, form.installments.length])

  // What the depot can promise on the day this order leaves: stock on hand
  // plus the confirmed orders that leave after it. The date has to be picked
  // first, which is why it sits above the depot in the form.
  const onDate = (warehouseId: string) => {
    const r = stockOnDate(purchases, sales.filter((x) => x.id !== editing?.id), warehouseId, form.scheduleDate || form.date)
    return r
  }
  const depotNow = form.warehouseId ? onDate(form.warehouseId) : null
  const available = Math.max(depotNow?.available ?? 0, 0)
  const exceeds = form.volumeLiters > available
  const stockAfter = Math.max(available - form.volumeLiters, 0)

  // What the collection plan actually covers. The InstallmentEditor draws its own
  // balance check, but it sits below the fold from where the total is typed.
  const planned = form.installments.reduce((sum, i) => sum + i.principal, 0)
  const unplanned = Math.round((totalPrice - planned) * 100) / 100

  // Bounced checks this customer already has on file, before another is taken.
  const bounced = selectedCustomer ? bouncedNote(bouncedFor(selectedCustomer.id, sales)) : null

  const problems: Record<string, string> = {}
  if (!form.agentId) problems.agentId = 'Select the sales agent.'
  if (!form.customerId) problems.customerId = 'Select a customer.'
  if (!form.scheduleDate) problems.scheduleDate = 'Pick the pickup or delivery date first - stock is checked for that day.'
  if (!form.warehouseId) problems.warehouseId = 'Select the source depot.'
  if (form.volumeLiters <= 0) problems.volumeLiters = 'Enter the volume sold.'
  if (form.pricePerLiter <= 0) problems.pricePerLiter = 'Enter the price per litre.'
  if (form.paymentMode === 'bank_transfer' && !form.bankAccountId) {
    problems.bankAccountId = 'Select the receiving bank account.'
  }
  if (exceeds && !overrideStock) problems.warehouseId = 'Exceeds what the depot can promise on that day. Authorise a pre-sale to proceed.'
  if (form.installments.length === 0) problems.installments = 'Add at least one collection entry.'
  else if (form.installments.some((i) => i.principal <= 0 || !i.dueDate)) {
    problems.installments = 'Each collection entry requires an amount and a due date.'
  }
  // Only after Save, so a form nobody has finished typing is not already red.
  const problem = (key: string) => (showProblems ? problems[key] : undefined)

  /**
   * The form's parts, for the nav. Each names the fields it owns so its mark
   * can be derived rather than tracked - one list to keep in step instead of
   * two, and a section cannot claim to be done while a field inside it is
   * empty.
   */
  const SECTIONS: { id: string; title: string; keys: string[]; filled: () => boolean }[] = [
    { id: 'sec-who', title: 'Agent & customer', keys: ['agentId', 'customerId'], filled: () => !!form.customerId && !!form.agentId },
    { id: 'sec-fuel', title: 'Order details', keys: ['scheduleDate', 'volumeLiters', 'pricePerLiter', 'warehouseId', 'bankAccountId'], filled: () => form.volumeLiters > 0 && form.pricePerLiter > 0 && !!form.warehouseId && !!form.scheduleDate },
    // Optional throughout, so it is done the moment anything is in it and
    // never nags when it is empty.
    { id: 'sec-po', title: 'References', keys: [], filled: () => !!form.clientPoReferenceNo.trim() || !!form.invoiceNo.trim() },
    { id: 'sec-plan', title: 'Collection plan', keys: ['installments'], filled: () => form.installments.length > 0 && Math.abs(totalPrice - planned) < 0.01 },
  ]
  const navSections: FormNavSection[] = SECTIONS.map((sec) => ({
    id: sec.id,
    title: sec.title,
    state: sec.keys.some((k) => problem(k)) ? 'problem' : sec.filled() ? 'done' : 'todo',
  }))
  const { active, jump } = useSectionNav(SECTIONS.map((sec) => sec.id))

  async function save() {
    // Every problem at once, on the field it belongs to.
    setShowProblems(true)
    if (Object.keys(problems).length > 0) {
      setError(`${Object.keys(problems).length === 1 ? 'One field needs' : `${Object.keys(problems).length} fields need`} attention.`)
      return
    }
    const { installments, productId, ...rest } = form
    const payload = {
      ...rest,
      // Blank means the default product - see src/lib/products.ts.
      productId: productId || undefined,
      pricePerLiter: Math.round(form.pricePerLiter * 100) / 100,
      date: new Date(form.date).toISOString(),
      scheduleDate: new Date(form.scheduleDate).toISOString(),
      scheduleTime: form.scheduleTime || undefined,
      clientPoReferenceNo: form.clientPoReferenceNo.trim() || undefined,
      invoiceNo: form.invoiceNo.trim() || undefined,
      contactPerson: form.contactPerson.trim() || undefined,
      contactNumber: form.contactNumber.trim() || undefined,
      deliveryAddress: form.deliveryAddress.trim() || undefined,
      termDays: form.paymentMode === 'cash' ? 0 : form.termDays,
      bankAccountId: form.paymentMode === 'bank_transfer' ? form.bankAccountId : undefined,
      collectorId: form.collectorId || undefined,
      installments: installments.map((i) => ({
        id: i.id,
        principal: i.principal,
        interestPct: i.interestPct,
        amount: installmentTotal(i.principal, i.interestPct),
        dueDate: new Date(i.dueDate).toISOString(),
        status: i.status,
        collectorId: i.collectorId,
        bankAccountId: i.bankAccountId,
        collectedAt: i.collectedAt,
        referenceNo: i.referenceNo,
        notes: i.notes,
      })) as Sale['installments'],
    }
    setError(null)
    try {
      if (editing) {
        // Editing corrects the sale's details only - status stays whatever it already was, not
        // reset by this form (each installment's own status is edited in the installment rows).
        const result = await repos.sales.update(editing.id, payload)
        if (isPending(result)) onNotice(result.message)
      } else {
        const sale = await repos.sales.add({ ...payload, status: 'draft' as const })

        // Under approvals (2.1) the sale isn't in the System yet - `sale` is a
        // pending-approval receipt, not a record. Confirming it here would build
        // a delivery in Logistics pointing at an id that doesn't exist, and the
        // trip would sit there orphaned whether or not the sale was ever
        // approved. So the confirm is dropped and the user is told why.
        if (isPending(sale)) {
          onNotice(
            confirmNow
              ? `${sale.message} Confirm it once approved - the delivery is created then.`
              : sale.message,
          )
        } else if (confirmNow) {
          await confirmSale(sale, {
            address: form.deliveryAddress,
            contactPerson: form.contactPerson,
            contactNumber: form.contactNumber,
          })
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t save this sale.')
      return
    }
    setForm(newSaleForm())
    setOverrideStock(false)
    onClose()
  }

  const termOptions = [0, 7, 15, 30, 45, 60, 90]
  const customTerm = !termOptions.includes(form.termDays)

  return (
    <Dialog
      open={open}
      title={readOnly ? 'Sale' : editing ? 'Edit sale' : 'New sale'}
      subtitle={selectedCustomer?.company}
      onClose={onClose}
      width={WIDE_DIALOG}
      nav={<FormNav sections={navSections} active={active} onJump={jump} />}
      rail={
        <>
          <RailSection title="This sale">
            <RailRow label="Volume" value={form.volumeLiters > 0 ? `${fmtNum(form.volumeLiters)} L` : '—'} />
            <RailRow label="Price per litre" value={form.pricePerLiter > 0 ? `₱${form.pricePerLiter.toFixed(2)}` : '—'} />
            <RailTotal label="Total" value={totalPrice > 0 ? fmtCurrency(totalPrice) : '—'} />
            <RailAside>
              {form.fulfillment === 'delivery' ? 'Delivery' : 'Customer pickup'}{form.scheduleDate ? ` · ${fmtDate(form.scheduleDate)}${form.scheduleTime ? ` ${form.scheduleTime}` : ''}` : ''}
              {' · '}{label(form.paymentMode)}{form.paymentMode === 'cash' ? '' : ` · ${fmtTerm(form.termDays)}`}
            </RailAside>
          </RailSection>

          {form.warehouseId && depotNow && (
            <RailSection title={warehouses.find((w) => w.id === form.warehouseId)?.name ?? 'Depot'}>
              <RailRow label="Stock on hand" value={`${fmtNum(Math.max(depotNow.onHand, 0))} L`} />
              {depotNow.leavingLater > 0 && (
                <RailDelta label={`Still there on ${fmtDate(form.scheduleDate || form.date)}`} value={`${fmtNum(depotNow.leavingLater)} L`} sign="+" />
              )}
              <RailDelta label="This sale" value={`${fmtNum(form.volumeLiters)} L`} sign="-" />
              {/* A negative close is what "does not fit" looks like, so it does
                  not also need saying in words. */}
              <RailClose
                label="Left that day"
                tone={exceeds ? 'bad' : 'plain'}
                value={exceeds
                  ? `${fmtNum(form.volumeLiters - available)} L short`
                  : `${fmtNum(stockAfter)} L`}
              />
              {exceeds && (
                <RailAside tone="bad">
                  <label className="flex cursor-pointer items-center gap-2 font-semibold">
                    <input type="checkbox" checked={overrideStock} onChange={(e) => setOverrideStock(e.target.checked)} />
                    Authorise pre-sale
                  </label>
                </RailAside>
              )}
            </RailSection>
          )}

          {totalPrice > 0 && (
            <RailSection title="Collection plan">
              <RailRow label="Total" value={fmtCurrency(totalPrice)} />
              <RailDelta label="Planned" value={fmtCurrency(planned)} sign="-" />
              <RailClose
                label={unplanned < 0 ? 'Over the total' : 'Left to plan'}
                tone={Math.abs(unplanned) < 0.01 ? 'plain' : 'bad'}
                value={fmtCurrency(Math.abs(unplanned))}
              />
              {Math.abs(unplanned) >= 0.01 && (
                <RailAside tone="bad">
                  {unplanned > 0 ? 'Add an entry or increase an amount.' : 'Reduce an amount.'}
                </RailAside>
              )}
            </RailSection>
          )}

          {bounced && (
            <RailSection title="Before taking a check">
              <RailAside tone="bad">{bounced}</RailAside>
            </RailSection>
          )}
        </>
      }
      footer={readOnly ? (
        <PrimaryButton onClick={onClose}>Close</PrimaryButton>
      ) : (
        <>
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton onClick={save}>{editing ? 'Save changes' : 'Save sale'}</PrimaryButton>
        </>
      )}
    >
      <fieldset disabled={readOnly} className="contents [&:disabled_*]:cursor-default">
      {readOnly && (
        <p className="mb-3 rounded-[6px] border border-line bg-paper px-3 py-2 font-meta text-[12px] text-mut">
          Viewing only. Changing the sale is Sales’ work; your seat records the payments on it from Collect or Treasury.
        </p>
      )}
      {error && (
        <p className="mb-3 rounded-[6px] border border-redf bg-redbadge px-3 py-2 text-[13px] font-semibold text-redtext">{error}</p>
      )}

      {/* Agent first: it is the agent booking the order who is at the
          keyboard, and the customer is theirs. Picking the customer fills the
          contact and address from the card. */}
      <FormSection first id="sec-who">Agent &amp; customer</FormSection>
      <div className="grid grid-cols-2 gap-x-4 gap-y-[14px]">
        <Field label="Agent" error={problem('agentId')}>
          <Select value={form.agentId} onChange={(e) => set('agentId', e.target.value)}>
            <option value="" disabled>Select an agent…</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </Field>
        <Field label="Customer" error={problem('customerId')}>
          <Select value={form.customerId} onChange={(e) => pickCustomer(e.target.value)}>
            <option value="" disabled>Select a customer…</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.company}</option>)}
          </Select>
        </Field>
        <Field label="Contact person" hint={selectedCustomer ? 'From the customer’s card - change it if this order goes to someone else.' : undefined}>
          <Input value={form.contactPerson} placeholder="Who receives the fuel" onChange={(e) => set('contactPerson', e.target.value)} />
        </Field>
        <Field label="Contact number">
          <Input value={form.contactNumber} placeholder="e.g. 0917 555 0148" onChange={(e) => set('contactNumber', e.target.value)} />
        </Field>
        <Field label={form.fulfillment === 'delivery' ? 'Delivery address' : 'Customer address'} span2>
          <Input value={form.deliveryAddress} placeholder="Street, barangay, city" onChange={(e) => set('deliveryAddress', e.target.value)} />
        </Field>
      </div>

      {/* The order: what, when, from where, and how it is paid - in that
          order, because the depot's availability depends on the day. */}
      <FormSection id="sec-fuel">Order details</FormSection>
      <div className="grid grid-cols-2 gap-x-4 gap-y-[14px]">
        <Field label="Volume (L)" error={problem('volumeLiters')}>
          <Input type="number" min={1} placeholder="e.g. 5000" value={form.volumeLiters || ''} onChange={(e) => set('volumeLiters', Number(e.target.value))} />
        </Field>
        <Field label="Price per litre (₱)" error={problem('pricePerLiter')} hint={totalPrice > 0 ? `Total ${fmtCurrency(totalPrice)}` : 'Volume × price gives the total.'}>
          <Input type="number" step="0.01" min={0} placeholder="e.g. 58.00" value={form.pricePerLiter || ''} onChange={(e) => set('pricePerLiter', Number(e.target.value))} />
        </Field>
        {showProduct && (
          <Field label="Product" span2>
            <Select value={form.productId} onChange={(e) => set('productId', e.target.value)}>
              {productOptions(products).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Fulfilment">
          <Select value={form.fulfillment} onChange={(e) => set('fulfillment', e.target.value)}>
            <option value="delivery">Delivery</option>
            <option value="pickup">Customer pickup</option>
          </Select>
        </Field>
        <Field label={form.fulfillment === 'delivery' ? 'Delivery date' : 'Pickup date'} error={problem('scheduleDate')} hint="Stock is checked for this day - pick it before the depot.">
          <Input type="date" value={form.scheduleDate} onChange={(e) => set('scheduleDate', e.target.value)} />
        </Field>
        {/* Exhibit A 1.3 asks for the requested schedule with date AND time.
            Optional - plenty of orders are booked for a day, not an hour. */}
        <Field label="Requested time" optional hint="Leave blank if no particular time was asked for.">
          <Input type="time" value={form.scheduleTime} onChange={(e) => set('scheduleTime', e.target.value)} />
        </Field>
        <Field
          label="From depot"
          error={problem('warehouseId')}
          hint={form.scheduleDate ? `Available on ${fmtDate(form.scheduleDate)}: stock on hand plus orders leaving after that day.` : 'Pick the date first.'}
        >
          <Select value={form.warehouseId} disabled={!form.scheduleDate} onChange={(e) => set('warehouseId', e.target.value)}>
            <option value="" disabled>Select a depot…</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>{w.name} - {fmtNum(Math.max(onDate(w.id).available, 0))} L available</option>
            ))}
          </Select>
        </Field>
        <Field label="Terms">
          <Select
            value={form.paymentMode === 'cash' ? 'cash' : customTerm ? 'custom' : String(form.termDays)}
            onChange={(e) => {
              const v = e.target.value
              if (v === 'cash') { set('paymentMode', 'cash'); set('termDays', 0) }
              else if (v === 'custom') { /* keep the typed days */ }
              else { if (form.paymentMode === 'cash') set('paymentMode', 'bank_transfer'); set('termDays', Number(v)) }
            }}
          >
            <option value="cash">Cash</option>
            {termOptions.filter((d) => d > 0).map((d) => <option key={d} value={d}>{fmtTerm(d)}</option>)}
            <option value="0">COD (on credit, due on delivery)</option>
            {customTerm && form.paymentMode !== 'cash' && <option value="custom">Net {form.termDays}</option>}
          </Select>
        </Field>
        <Field label="Mode of payment" span2={form.paymentMode !== 'bank_transfer'}>
          <Select value={form.paymentMode} onChange={(e) => { set('paymentMode', e.target.value); if (e.target.value === 'cash') set('termDays', 0) }}>
            <option value="bank_transfer">Bank transfer</option>
            <option value="cash">Cash</option>
            <option value="check">Check</option>
          </Select>
        </Field>
        {form.paymentMode === 'bank_transfer' && (
          <Field label="Deposit to bank account" error={problem('bankAccountId')}>
            <Select value={form.bankAccountId} onChange={(e) => set('bankAccountId', e.target.value)}>
              <option value="" disabled>Select an account…</option>
              {bankAccounts.map((b) => <option key={b.id} value={b.id}>{b.bankName} {b.accountNumberMasked}</option>)}
            </Select>
          </Field>
        )}
      </div>

      <FormSection id="sec-po">References</FormSection>
      <div className="grid grid-cols-2 gap-x-4 gap-y-[14px]">
        <Field label="Client PO number" optional hint="The reference on the client’s own purchase order.">
          <Input value={form.clientPoReferenceNo} placeholder="e.g. ACME-PO-8842" onChange={(e) => set('clientPoReferenceNo', e.target.value)} />
        </Field>
        <Field label="Sales invoice number" optional hint="Once the invoice is issued. The DR number is typed at dispatch.">
          <Input value={form.invoiceNo} placeholder="e.g. SI-2026-0412" onChange={(e) => set('invoiceNo', e.target.value)} />
        </Field>
      </div>
      {editing ? (
        <div className="mt-3">
          <DocumentUpload tbl="sales" recordId={editing.id} slots={['clientPo']} />
        </div>
      ) : (
        <p className="mt-2 text-[12px] text-faint">
          Save the order first, then reopen it to attach the client’s PO.
        </p>
      )}

      <FormSection id="sec-plan">
        Collection plan
        {!editing && form.installments.length === 1 && form.paymentMode !== 'cash' && (
          <span className="ml-2 text-[10.5px] font-normal normal-case tracking-normal text-faint">
            due date follows the {fmtTerm(form.termDays)} terms above - add a row to split into installments
          </span>
        )}
      </FormSection>
      <div className="mb-3 grid grid-cols-2 gap-3">
        <Field label="Assigned collector" hint="Individual entries may override this.">
          <Select value={form.collectorId} onChange={(e) => set('collectorId', e.target.value)}>
            <option value="">Unassigned</option>
            {activePersonnel.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
      </div>
      {/* The editor is not inside a Field, so its problem is said here rather
          than going missing with the banner it used to live in. */}
      {problem('installments') && (
        <p className="m-0 mb-2 font-meta text-[12px] font-semibold text-redtext">{problem('installments')}</p>
      )}
      <InstallmentEditor
        rows={form.installments}
        onChange={(rows) => set('installments', rows)}
        statusOptions={saleInstallmentStatusOptions}
        totalPrice={totalPrice}
        presets={standardInstallmentPresets({
          date: form.date,
          totalPrice,
          termDays: form.termDays,
          pendingStatus: saleInstallmentStatusOptions[0].value,
        })}
        collectorOptions={activePersonnel.map((p) => ({ value: p.id, label: p.name }))}
        bankOptions={bankAccounts.map((b) => ({ value: b.id, label: `${b.bankName} ${b.accountNumberMasked}` }))}
      />
      {!editing && (
        <label className="mt-4 flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={confirmNow} onChange={(e) => setConfirmNow(e.target.checked)} />
          Confirm immediately - creates the delivery trip
        </label>
      )}
      </fieldset>
    </Dialog>
  )
}

function newSaleForm() {
  return {
    agentId: '',
    customerId: '',
    date: todayISO(),
    pricePerLiter: 0,
    volumeLiters: 0,
    warehouseId: '',
    fulfillment: 'delivery' as Sale['fulfillment'],
    scheduleDate: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
    scheduleTime: '',
    clientPoReferenceNo: '',
    invoiceNo: '',
    contactPerson: '',
    contactNumber: '',
    deliveryAddress: '',
    termDays: 30,
    productId: '',
    paymentMode: 'bank_transfer' as Sale['paymentMode'],
    bankAccountId: '',
    collectorId: '',
    installments: [
      {
        id: nanoid(8), principal: 0, interestPct: 0,
        dueDate: new Date(Date.now() + 15 * 86_400_000).toISOString().slice(0, 10), status: 'pending',
      },
    ] as InstallmentRow[],
  }
}

/** Loads an existing sale into the form shape. A sale from before terms were
 * stored reads its term off the last due date. */
function saleToForm(s: Sale, customer?: Customer) {
  const last = s.installments.reduce((m, i) => (i.dueDate > m ? i.dueDate : m), '')
  const inferred = last ? Math.max(Math.round((Date.parse(last) - Date.parse(s.date)) / 86_400_000), 0) : 30
  return {
    agentId: s.agentId,
    customerId: s.customerId,
    date: s.date.slice(0, 10),
    pricePerLiter: s.pricePerLiter,
    volumeLiters: s.volumeLiters,
    warehouseId: s.warehouseId,
    fulfillment: s.fulfillment,
    scheduleDate: (s.scheduleDate ?? s.date).slice(0, 10),
    scheduleTime: s.scheduleTime ?? '',
    clientPoReferenceNo: s.clientPoReferenceNo ?? '',
    invoiceNo: s.invoiceNo ?? '',
    // Orders booked before the snapshot existed fall back to the customer's
    // card, so the fields are not blank on an old order.
    contactPerson: s.contactPerson ?? customer?.delivery?.contactPerson ?? customer?.contactPerson ?? '',
    contactNumber: s.contactNumber ?? customer?.delivery?.contactNumber ?? customer?.contactNumber ?? '',
    deliveryAddress: s.deliveryAddress ?? customer?.delivery?.address ?? customer?.address ?? '',
    termDays: s.termDays ?? (s.paymentMode === 'cash' ? 0 : inferred),
    productId: s.productId ?? '',
    paymentMode: s.paymentMode,
    bankAccountId: s.bankAccountId ?? '',
    collectorId: s.collectorId ?? '',
    installments: s.installments.map((i): InstallmentRow => ({
      id: i.id, principal: i.principal, interestPct: i.interestPct, dueDate: i.dueDate.slice(0, 10), status: i.status,
      collectorId: i.collectorId, bankAccountId: i.bankAccountId, collectedAt: i.collectedAt,
      referenceNo: i.referenceNo, notes: i.notes,
    })),
  }
}
