import { useEffect, useState } from 'react'
import { CreateAction } from '../../lib/quickCreate'
import { useToast } from '../../components/Toast'
import { nanoid } from 'nanoid'
import { fetchTable, useTables } from '../../lib/data'
import { confirmSale, repos } from '../../data/repo'
import {
  agentStats, inRange, isInstallmentOverdue, revenue, stockByWarehouse, volumeOut,
  type DateRange,
} from '../../lib/metrics'
import { RangePicker, useRange } from '../../lib/range'
import { useQuickCreate } from '../../lib/quickCreate'
import { compareValues, useSortableTable } from '../../lib/sort'
import { todayISO, addDaysISO, fmtCompactPeso, fmtCurrency, fmtDate, fmtLiters, fmtNum, fmtTerm, label } from '../../lib/format'
import { InfoTip, ExportButton, Card, Chip, DataTable, Dialog, Field, FormSection, GhostButton, Input, KpiStrip, MiniDark, PageHeader, PrimaryButton, Select, filterCls, td } from '../../components/ui'
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
import { planRevertResolution } from '../../lib/orderResolution'
import ResolveOrderDialog from './ResolveOrderDialog'
import type { Agent, BankAccount, Customer, Personnel, Product, Sale, Warehouse } from '../../data/types'

const saleInstallmentStatusOptions = [
  { value: 'pending', label: 'Pending' },
  { value: 'collected', label: 'Collected' },
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

  const data = useTables(['sales', 'purchases', 'agents', 'customers', 'warehouses', 'bankAccounts', 'personnel', 'products'] as const)
  if (!data) return null
  const { sales, purchases, agents, customers, warehouses, bankAccounts, personnel, products } = data
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

  const sortAccessors: Record<string, (s: Sale) => string | number> = {
    date: (s) => s.date,
    customer: (s) => customer(s.customerId)?.company ?? '',
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
      address: c?.delivery?.address ?? c?.address ?? '',
      contactPerson: c?.delivery?.contactPerson ?? c?.contactPerson ?? '',
      contactNumber: c?.delivery?.contactNumber ?? c?.contactNumber ?? '',
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
    const collected = installments.filter((i) => i.status === 'collected').length
    const allCancelled = total > 0 && installments.every((i) => i.status === 'cancelled')
    const allCollected = total > 0 && collected === total
    const statusKey = allCancelled ? 'cancelled' : allCollected ? 'collected' : 'pending'
    const text = total > 1 && !allCancelled && !allCollected ? `${collected}/${total} collected` : label(statusKey)
    return { statusKey, text, anyOverdue: installments.some((i) => isInstallmentOverdue(i)) }
  }

  /** Secondary Feature 2.12 - exports exactly what is filtered on screen. */
  function exportSales(list: Sale[]) {
    exportTable(
      `sales-${range.from.slice(0, 10)}-to-${range.to.slice(0, 10)}`,
      'Sales',
      [
        'Date', 'Client PO', 'Customer', 'Agent', 'Depot', 'Product', 'Fulfillment',
        'Scheduled', 'Volume (L)', 'Price per liter', 'Total', 'Payment mode', 'Status',
        'Reason', 'Treatment', 'Volume returned (L)',
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
        s.resolution ? label(s.resolution.treatment) : '',
        s.resolution?.volumeReturned ?? null,
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

      <div className="mb-[18px] grid grid-cols-[2fr_1.2fr] gap-[18px]">
        <KpiStrip
          delay={50}
          items={[
            {
              label: (
                <span className="inline-flex items-center gap-[5px]">
                  Volume sold
                  <InfoTip label="What volume sold counts">
                    Volume that left a depot, counted on the sale date. Drafts and
                    cancelled orders count as nothing. A return is netted down only by
                    what came back into stock: a return settled by refund, credit note,
                    replacement or write-off still counts in full, because the fuel
                    went out and did not come back. The percentage compares with the
                    period of the same length immediately before the selected range.
                  </InfoTip>
                </span>
              ),
              value: fmtLiters(sold),
              sub: delta !== null && (
                <span className={`font-semibold ${delta >= 0 ? 'text-teal' : 'text-redtext'}`}>
                  {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}%
                </span>
              ),
            },
            {
              label: (
                <span className="inline-flex items-center gap-[5px]">
                  Revenue
                  <InfoTip label="How the average is worked out">
                    Volume times the agreed price on each sale. The average underneath
                    is this revenue divided by the same net volume above it, so the two
                    figures always agree - it is not an average of the per-sale prices,
                    which would weight a 200-litre sale the same as a 20,000-litre one.
                  </InfoTip>
                </span>
              ),
              value: fmtCompactPeso(rev),
              sub: <span>avg {sold > 0 ? `₱${(rev / sold).toFixed(2)}/L` : '—'}</span>,
            },
            { label: 'Drafts', value: fmtNum(drafts), sub: <span>waiting to confirm</span> },
          ]}
        />
        {/* The dashboard's card, not a second implementation of it.
            This one coloured its bar red below half quota and amber below
            eighty, which reads as an emergency on the third of the month and
            contradicts the rule the rest of the app follows: amber is watch,
            red is act now. It also showed a percentage with no volume beside
            it, and ranked five agents at 0% as though that were a ranking when
            nobody had sold anything in the period. */}
        <TopAgentsCard
          stats={agentStats(agents, sales, range)}
          monthLabel={new Date().toLocaleDateString('en-PH', { month: 'long' })}
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
              { label: 'Date', sortKey: 'date' }, { label: 'Customer / agent', sortKey: 'customer' }, { label: 'Volume (₱/L)', align: 'right', sortKey: 'volume' },
              { label: 'Total', align: 'right', sortKey: 'total' }, { label: 'Payment', sortKey: 'payment' }, { label: 'Status', sortKey: 'status' }, { label: '' },
            ]}
          >
            {rows.map((s) => (
              <tr key={s.id} className="hover:bg-hovrow">
                <td className={`${td} whitespace-nowrap pl-5 text-mut`}>{fmtDate(s.date)}</td>
                <td className={td}>
                  <p className="m-0 font-semibold">{customer(s.customerId)?.company ?? '—'}</p>
                  <p className="m-0 text-[12px] text-faint">
                    {agentName(s.agentId)} · {s.fulfillment === 'delivery' ? 'Delivery' : 'Customer pickup'}
                    {showProduct ? ` · ${productName(products, s.productId)}` : ''}
                  </p>
                  {s.clientPoReferenceNo && <p className="m-0 text-[12px] text-faint">Client PO {s.clientPoReferenceNo}</p>}
                </td>
                <td className={`${td} whitespace-nowrap text-right`}>
                  <p className="m-0 font-semibold">{fmtLiters(s.volumeLiters)}</p>
                  <p className="m-0 text-[12px] text-faint">₱{s.pricePerLiter.toFixed(2)}/L</p>
                </td>
                <td className={`${td} whitespace-nowrap text-right font-semibold`}>{fmtCurrency(s.volumeLiters * s.pricePerLiter).replace('.00', '')}</td>
                <td className={td}>
                  <p className="m-0 mb-[2px] text-mut">{label(s.paymentMode)}</p>
                  {(() => {
                    const badge = installmentBadge(s.installments)
                    return (
                      <span className="inline-flex flex-wrap items-center gap-[5px]">
                        <Chip status={badge.statusKey} text={badge.text} />
                        {badge.anyOverdue && <Chip status="overdue" text="Overdue" />}
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
                      {label(s.resolution.treatment)} - {s.resolution.reason}
                    </p>
                  )}
                </td>
                <td className={`${td} pr-5 text-right`}>
                  <span className="inline-flex items-center gap-3">
                    {s.status === 'draft' && <MiniDark onClick={() => confirm(s)}>Confirm</MiniDark>}
                    {s.status === 'confirmed' && <MiniDark onClick={() => markFulfilled(s)}>Mark fulfilled</MiniDark>}
                    {/* Exhibit A 1.3 - cancelled and returned orders, with reason
                        and treatment. Cancelling applies before the fuel moves;
                        returning applies after, which is why a fulfilled order
                        offers Return and an unfulfilled one offers Cancel. */}
                    {(s.status === 'draft' || s.status === 'confirmed') && (
                      <button
                        onClick={() => setResolving({ sale: s, kind: 'cancelled' })}
                        className="cursor-pointer px-[2px] py-1 text-[11px] font-semibold uppercase text-faint hover:text-redtext hover:underline"
                      >
                        Cancel
                      </button>
                    )}
                    {s.status === 'fulfilled' && (
                      <button
                        onClick={() => setResolving({ sale: s, kind: 'returned' })}
                        className="cursor-pointer px-[2px] py-1 text-[11px] font-semibold uppercase text-faint hover:text-redtext hover:underline"
                      >
                        Return
                      </button>
                    )}
                    {s.status !== 'draft' && (
                      <button
                        onClick={() => revertStatus(s)}
                        className="cursor-pointer px-[2px] py-1 text-[11px] font-semibold uppercase text-faint hover:text-redtext hover:underline"
                      >
                        Revert
                      </button>
                    )}
                    <button onClick={() => openEdit(s)} className="cursor-pointer px-[2px] py-1 text-[11px] font-semibold uppercase text-tealtext hover:underline">Edit</button>
                  </span>
                </td>
              </tr>
            ))}
          </DataTable>
      </Card>

      <SaleForm
        open={formOpen} onClose={closeForm} editing={editingSale}
        agents={agents} customers={customers} warehouses={warehouses} bankAccounts={bankAccounts}
        personnel={personnel} stock={stockByWarehouse(purchases, sales)}
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

function SaleForm({ open, onClose, editing, agents, customers, warehouses, bankAccounts, personnel, stock, products, showProduct, onNotice }: {
  open: boolean
  onClose: () => void
  editing: Sale | null
  agents: Agent[]
  customers: Customer[]
  warehouses: Warehouse[]
  bankAccounts: BankAccount[]
  personnel: Personnel[]
  stock: Map<string, number>
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
    setForm(editing ? saleToForm(editing) : newSaleForm())
    setConfirmNow(true)
    setOverrideStock(false)
    setShowProblems(false)
    setError(null)
  }, [open, editing])
  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }))

  const selectedCustomer = customers.find((c) => c.id === form.customerId)
  const activePersonnel = personnel.filter((p) => p.active !== false)
  // Automation: while the installment plan is still just the default single row (the common
  // case), its due date auto-fills from the customer's own standing payment term (cash always
  // settles same-day) whenever the customer, sale date, or payment mode changes - same as it
  // would in a real invoicing flow. The moment someone builds out a real multi-installment
  // plan (or is editing an existing sale), their entries are left alone.
  useEffect(() => {
    if (editing || !open || !selectedCustomer || form.installments.length !== 1) return
    const due = form.paymentMode === 'cash' ? form.date : addDaysISO(form.date, selectedCustomer.paymentTermDays)
    setForm((f) => (f.installments.length !== 1 || f.installments[0].dueDate === due
      ? f
      : { ...f, installments: [{ ...f.installments[0], dueDate: due }] }))
  }, [form.customerId, form.date, form.paymentMode, editing, open, selectedCustomer, form.installments.length])
  // Same convenience for the amount: a single default row's base amount tracks the total price
  // field so the common one-payment case never needs the number typed twice.
  useEffect(() => {
    if (editing || !open || form.installments.length !== 1) return
    const amt = Math.round(form.totalPrice * 100) / 100
    setForm((f) => (f.installments.length !== 1 || f.installments[0].principal === amt
      ? f
      : { ...f, installments: [{ ...f.installments[0], principal: amt }] }))
  }, [form.totalPrice, editing, open, form.installments.length])

  // When editing, this sale's own volume is already subtracted from the depot's current
  // stock - add it back (if the depot hasn't changed) so editing to the same or a smaller
  // volume never falsely trips the "exceeds stock" warning.
  const alreadyCounted = editing && editing.warehouseId === form.warehouseId ? editing.volumeLiters : 0
  const available = Math.max((stock.get(form.warehouseId) ?? 0) + alreadyCounted, 0)
  const exceeds = form.volumeLiters > available
  // The form takes the total the customer pays; price per liter - the value actually
  // stored on the sale, and what every other screen (Sales, Accounts) reads - is derived.
  const pricePerLiter = form.volumeLiters > 0 ? form.totalPrice / form.volumeLiters : 0

  // What the collection plan actually covers. The InstallmentEditor draws its own
  // balance check, but it sits below the fold from where the total is typed.
  const planned = form.installments.reduce((sum, i) => sum + i.principal, 0)
  const unplanned = Math.round((form.totalPrice - planned) * 100) / 100
  const stockAfter = Math.max(available - form.volumeLiters, 0)

  const problems: Record<string, string> = {}
  if (!form.customerId) problems.customerId = 'Select a customer.'
  if (!form.agentId) problems.agentId = 'Select the sales agent.'
  if (!form.warehouseId) problems.warehouseId = 'Select the source depot.'
  if (form.volumeLiters <= 0) problems.volumeLiters = 'Enter the volume sold.'
  if (form.totalPrice <= 0) problems.totalPrice = 'Enter the total price.'
  if (form.paymentMode === 'bank_transfer' && !form.bankAccountId) {
    problems.bankAccountId = 'Select the receiving bank account.'
  }
  if (exceeds && !overrideStock) problems.warehouseId = 'Exceeds available stock. Authorise a pre-sale to proceed.'
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
    { id: 'sec-who', title: 'Customer & agent', keys: ['customerId', 'agentId'], filled: () => !!form.customerId && !!form.agentId },
    { id: 'sec-fuel', title: 'Order details', keys: ['volumeLiters', 'totalPrice', 'warehouseId'], filled: () => form.volumeLiters > 0 && form.totalPrice > 0 && !!form.warehouseId },
    // Optional throughout, so it is done the moment anything is in it and
    // never nags when it is empty.
    { id: 'sec-po', title: 'Client PO', keys: [], filled: () => !!form.clientPoReferenceNo.trim() },
    { id: 'sec-delivery', title: 'Delivery & payment', keys: ['bankAccountId'], filled: () => !!form.scheduleDate },
    { id: 'sec-plan', title: 'Collection plan', keys: ['installments'], filled: () => form.installments.length > 0 && Math.abs(form.totalPrice - planned) < 0.01 },
  ]
  const navSections: FormNavSection[] = SECTIONS.map((sec) => ({
    id: sec.id,
    title: sec.title,
    state: sec.keys.some((k) => problem(k)) ? 'problem' : sec.filled() ? 'done' : 'todo',
  }))
  const { active, jump } = useSectionNav(SECTIONS.map((sec) => sec.id))

  async function save() {
    // Every problem at once, on the field it belongs to. This used to be nine
    // sequential `return setError(...)` guards, so you fixed the first to be
    // told about the second - and the message appeared in a banner at the top
    // rather than on the control that was wrong.
    setShowProblems(true)
    if (Object.keys(problems).length > 0) {
      setError(`${Object.keys(problems).length === 1 ? 'One field needs' : `${Object.keys(problems).length} fields need`} attention.`)
      return
    }
    const { totalPrice: _totalPrice, installments, productId, ...rest } = form
    const payload = {
      ...rest,
      // Blank means the default product - see src/lib/products.ts.
      productId: productId || undefined,
      pricePerLiter: Math.round(pricePerLiter * 100) / 100,
      date: new Date(form.date).toISOString(),
      scheduleDate: new Date(form.scheduleDate).toISOString(),
      scheduleTime: form.scheduleTime || undefined,
      clientPoReferenceNo: form.clientPoReferenceNo.trim() || undefined,
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
          const c = customers.find((x) => x.id === form.customerId)
          await confirmSale(sale, {
            address: c?.address ?? '',
            contactPerson: c?.contactPerson ?? '',
            contactNumber: c?.contactNumber ?? '',
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

  return (
    <Dialog
      open={open}
      title={editing ? 'Edit sale' : 'New sale'}
      subtitle={selectedCustomer?.company}
      onClose={onClose}
      width={1100}
      nav={<FormNav sections={navSections} active={active} onJump={jump} />}
      rail={
        <>
          <RailSection title="This sale">
            <RailRow label="Volume" value={form.volumeLiters > 0 ? `${fmtNum(form.volumeLiters)} L` : '—'} />
            <RailRow label="Price per litre" value={pricePerLiter > 0 ? `₱${pricePerLiter.toFixed(2)}` : '—'} />
            <RailTotal label="Total price" value={form.totalPrice > 0 ? fmtCurrency(form.totalPrice).replace('.00', '') : '—'} />
          </RailSection>

          {form.warehouseId && (
            <RailSection title={warehouses.find((w) => w.id === form.warehouseId)?.name ?? 'Depot'}>
              <RailRow label="Stock now" value={`${fmtNum(available)} L`} />
              <RailDelta label="This sale" value={`${fmtNum(form.volumeLiters)} L`} sign="-" />
              {/* A negative close is what "does not fit" looks like, so it does
                  not also need saying in words. */}
              <RailClose
                label="Stock after"
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

          {form.totalPrice > 0 && (
            <RailSection title="Collection plan">
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
          <PrimaryButton onClick={save}>{editing ? 'Save changes' : 'Save sale'}</PrimaryButton>
        </>
      }
    >
      {error && (
        <p className="mb-3 rounded-[6px] border border-redf bg-redbadge px-3 py-2 text-[13px] font-semibold text-redtext">{error}</p>
      )}
      <FormSection first id="sec-who">Customer &amp; agent</FormSection>
      <div className="grid grid-cols-2 gap-x-4 gap-y-[14px]">
        <Field label="Customer" error={problem('customerId')}>
          <Select value={form.customerId} onChange={(e) => set('customerId', e.target.value)}>
            <option value="" disabled>Select a customer…</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.company}</option>)}
          </Select>
        </Field>
        <Field label="Agent" error={problem('agentId')}>
          <Select value={form.agentId} onChange={(e) => set('agentId', e.target.value)}>
            <option value="" disabled>Select an agent…</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </Field>
      </div>
      <FormSection id="sec-fuel">Order details</FormSection>
      <div className="grid grid-cols-2 gap-x-4 gap-y-[14px]">
        <Field label="Volume (L)" error={problem('volumeLiters')}>
          <Input type="number" min={1} placeholder="e.g. 5000" value={form.volumeLiters || ''} onChange={(e) => set('volumeLiters', Number(e.target.value))} />
        </Field>
        <Field label="Total price (₱)" error={problem('totalPrice')}>
          <Input type="number" step="0.01" min={0} placeholder="e.g. 290000" value={form.totalPrice || ''} onChange={(e) => set('totalPrice', Number(e.target.value))} />
        </Field>
        {showProduct && (
          <Field label="Product" span2>
            <Select value={form.productId} onChange={(e) => set('productId', e.target.value)}>
              {productOptions(products).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
        )}
        <Field label="From depot" span2 error={problem('warehouseId')}>
          <Select value={form.warehouseId} onChange={(e) => set('warehouseId', e.target.value)}>
            <option value="" disabled>Select a depot…</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>{w.name} - {fmtNum(Math.max(stock.get(w.id) ?? 0, 0))} L available</option>
            ))}
          </Select>
        </Field>
      </div>
      <FormSection id="sec-po">Client purchase order</FormSection>
      <div className="grid grid-cols-2 gap-x-4 gap-y-[14px]">
        <Field
          label="Client PO reference number"
          span2
          hint="The reference number on the client’s own purchase order."
        >
          <Input
            value={form.clientPoReferenceNo}
            placeholder="e.g. ACME-PO-8842"
            onChange={(e) => set('clientPoReferenceNo', e.target.value)}
          />
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

      <FormSection id="sec-delivery">Delivery &amp; payment</FormSection>
      <div className="grid grid-cols-2 gap-x-4 gap-y-[14px]">
        <Field label="Fulfillment">
          <Select value={form.fulfillment} onChange={(e) => set('fulfillment', e.target.value)}>
            <option value="delivery">Delivery</option>
            <option value="pickup">Customer pickup</option>
          </Select>
        </Field>
        <Field label="Schedule date">
          <Input type="date" value={form.scheduleDate} onChange={(e) => set('scheduleDate', e.target.value)} />
        </Field>
        {/* Exhibit A 1.3 asks for the requested schedule with date AND time.
            Optional - plenty of orders are booked for a day, not an hour. */}
        <Field label="Requested time" hint="Optional. Leave blank if no specific time was requested.">
          <Input type="time" value={form.scheduleTime} onChange={(e) => set('scheduleTime', e.target.value)} />
        </Field>
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
          <Field label="Deposit to bank account" error={problem('bankAccountId')}>
            <Select value={form.bankAccountId} onChange={(e) => set('bankAccountId', e.target.value)}>
              <option value="" disabled>Select an account…</option>
              {bankAccounts.map((b) => <option key={b.id} value={b.id}>{b.bankName} {b.accountNumberMasked}</option>)}
            </Select>
          </Field>
        )}
      </div>
      <FormSection id="sec-plan">
        Collection plan
        {!editing && selectedCustomer && form.installments.length === 1 && (
          <span className="ml-2 text-[10.5px] font-normal normal-case tracking-normal text-faint">
            due date auto-fills from {selectedCustomer.company}'s {fmtTerm(selectedCustomer.paymentTermDays)} terms - add a row to split into installments
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
        totalPrice={form.totalPrice}
        presets={standardInstallmentPresets({
          date: form.date,
          totalPrice: form.totalPrice,
          termDays: selectedCustomer?.paymentTermDays,
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
    </Dialog>
  )
}

function newSaleForm() {
  return {
    agentId: '',
    customerId: '',
    date: todayISO(),
    totalPrice: 0,
    volumeLiters: 0,
    warehouseId: '',
    fulfillment: 'delivery' as Sale['fulfillment'],
    scheduleDate: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
    scheduleTime: '',
    clientPoReferenceNo: '',
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

/** Loads an existing sale into the form shape - total price is derived back from the stored
 * price per liter, since that's what the form's "Total price" field takes as input. */
function saleToForm(s: Sale) {
  return {
    agentId: s.agentId,
    customerId: s.customerId,
    date: s.date.slice(0, 10),
    totalPrice: Math.round(s.volumeLiters * s.pricePerLiter * 100) / 100,
    volumeLiters: s.volumeLiters,
    warehouseId: s.warehouseId,
    fulfillment: s.fulfillment,
    scheduleDate: (s.scheduleDate ?? s.date).slice(0, 10),
    scheduleTime: s.scheduleTime ?? '',
    clientPoReferenceNo: s.clientPoReferenceNo ?? '',
    productId: s.productId ?? '',
    paymentMode: s.paymentMode,
    bankAccountId: s.bankAccountId ?? '',
    collectorId: s.collectorId ?? '',
    installments: s.installments.map((i): InstallmentRow => ({
      id: i.id, principal: i.principal, interestPct: i.interestPct, dueDate: i.dueDate.slice(0, 10), status: i.status,
      collectorId: i.collectorId, bankAccountId: i.bankAccountId, collectedAt: i.collectedAt,
    })),
  }
}
