import { useMemo, useState, type ReactNode } from 'react'
import { PhoneSkeleton } from '../../components/ui'
import { nanoid } from 'nanoid'
import { ArrowRight, Banknote, Plus, Warehouse } from 'lucide-react'
import { useTables } from '../../lib/data'
import { repos } from '../../data/repo'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../components/Toast'
import { isPending, useApprovals, type ApprovalRequest } from '../../lib/approvals'
import { addDaysISO, dayISO, fmtCurrency, fmtCurrencyShort, fmtDate, fmtDayMonth, fmtNum, label, todayISO } from '../../lib/format'
import { hasCatalog, productName, productOptions } from '../../lib/products'
import { isSettled, wasCollected } from '../../lib/collectionStatus'
import {
  Action, BigFigure, Card, CardList, CompactRow, Dock, Fab, FieldBody, FieldChoice, FieldEmpty, FieldField,
  FieldHeader, FieldInput, FieldRow, FieldSectionLabel, FieldSelect, FieldTabs, IconRow, Pill,
  ScreenStack, SheetHeader, SummaryStrip, useFieldWindow,
} from './shell'
import type { BankAccount, Customer, Sale, Warehouse as Depot } from '../../data/types'

/**
 * The sales agent's screens: what they have sold, and the one form that adds to it.
 *
 * An agent is not an office seat on a smaller screen. The office asks which
 * sales exist, whose they are and how the depot is doing; an agent asks what is
 * still owed me, what is still with the office, and let me write this one down
 * before I drive away from the customer. The money leads for that reason.
 *
 * Two things here are easy to get wrong and worth stating:
 *
 * 1. A sale an agent records does not exist yet. Non-admin writes to `sales`
 *    park in the approvals queue, so the new sale is NOT in the sales table and
 *    would vanish from this screen the moment it was submitted. The pending
 *    submissions are read back from /approvals - which already narrows itself to
 *    the caller when they cannot approve - and shown on their own tab, which the
 *    screen lands on after recording one.
 *
 * 2. The agent is never asked who sold it. `Sale.agentId` is taken from the
 *    seat's own Personnel row; the server refuses a sale the seat would not own
 *    anyway (server/scope.ts), so offering the field would only be offering a
 *    way to fail.
 */
type Tab = 'owed' | 'waiting' | 'all'

export default function MySales() {
  const { seat } = useAuth()
  const [openId, setOpenId] = useState<string | null>(null)
  const [composing, setComposing] = useState(false)
  /** Which tab the list opens on. Held here because recording a sale has to be
   *  able to point at the tab the submission landed in. */
  const [tab, setTab] = useState<Tab>('owed')
  const data = useTables(['sales', 'customers', 'warehouses', 'bankAccounts', 'personnel', 'products'] as const)
  const pendingQ = useApprovals('pending')
  if (!data) return <PhoneSkeleton />
  const { sales, customers, warehouses, bankAccounts, personnel, products } = data

  // The agent comes from the session, not from the employee row: the server
  // strips `Personnel.agentId` (an HR field) for seats without HR access, which
  // is every field seat. The employee row is only a fallback for HR-capable
  // seats reaching this screen.
  const me = personnel.find((p) => p.id === seat?.personnelId)
  const agentId = seat?.agentId ?? me?.agentId ?? undefined
  const company = (id: string) => customers.find((c) => c.id === id)?.company ?? 'Customer'

  // Parked submissions of mine. The queue is already scoped to this seat by the
  // server for anyone who cannot approve.
  const parked = (pendingQ.data?.rows ?? []).filter((r) => r.tbl === 'sales' && r.action === 'create')

  // Which screen is up, and how deep it is - the stack draws the move.
  const stack = (screen: string, depth: number, node: ReactNode) =>
    <ScreenStack screen={screen} depth={depth}>{node}</ScreenStack>

  if (composing && !agentId) return stack('no-agent', 1, <NoAgentSeat onBack={() => setComposing(false)} />)
  if (composing && agentId) {
    return stack('new', 1,
      <NewSale
        agentId={agentId}
        customers={customers}
        warehouses={warehouses}
        bankAccounts={bankAccounts}
        products={products}
        // Land on the tab the new submission is in: the thing you just did
        // should not be on a tab you have to go and find.
        onDone={(recorded) => {
          setComposing(false)
          pendingQ.refetch()
          if (recorded) setTab('waiting')
        }}
      />,
    )
  }

  const open = sales.find((s) => s.id === openId)
  if (open) {
    return stack(`sale:${open.id}`, 1,
      <SaleSheet
        sale={open}
        company={company(open.customerId)}
        depot={warehouses.find((w) => w.id === open.warehouseId)?.name}
        product={hasCatalog(products) ? productName(products, open.productId) : undefined}
        bank={bankAccounts.find((b) => b.id === open.bankAccountId)}
        onBack={() => setOpenId(null)}
      />,
    )
  }

  return stack('list', 0,
    <SalesList
      sales={sales}
      parked={parked}
      company={company}
      tab={tab}
      onTab={setTab}
      onOpen={setOpenId}
      onNew={() => setComposing(true)}
    />,
  )
}

const owing = (s: Sale) => s.installments.filter((i) => i.status === 'pending')
const totalOf = (s: Sale) => s.volumeLiters * s.pricePerLiter
const stillOwed = (s: Sale) => owing(s).reduce((n, i) => n + i.amount, 0)
const peso = (n: number) => fmtCurrency(n).replace('.00', '')

/**
 * The list, with its own search and paging state.
 *
 * Split out because MySales returns the sheet and the capture form early, and a
 * hook below an early return is a hook that sometimes does not run - React
 * counts them and throws.
 *
 * One line per row. The name on the left, the figure the tab is about on the
 * right, and one short line under the name saying when. Everything else a sale
 * has - litres, status, the sale date - is on its own screen, one tap away, and
 * putting it on the row made the list read as prose.
 */
function SalesList({ sales, parked, company, tab, onTab, onOpen, onNew }: {
  sales: Sale[]
  parked: ApprovalRequest[]
  company: (id: string) => string
  tab: Tab
  onTab: (t: Tab) => void
  onOpen: (id: string) => void
  onNew: () => void
}) {
  const [q, setQ] = useState('')
  const [searching, setSearching] = useState(false)
  const today = todayISO()
  const overdue = (s: Sale) => owing(s).filter((i) => dayISO(i.dueDate) < today)

  // The server hands back only this agent's sales; the tabs are about what
  // still wants something, not about who owns what.
  const mine = [...sales].sort((a, b) => b.date.localeCompare(a.date))
  const owed = mine.filter((s) => stillOwed(s) > 0)
    // Soonest due first, which puts the overdue ones at the top - the order
    // somebody chasing money would put them in themselves.
    .sort((a, b) => (owing(a)[0]?.dueDate ?? '').localeCompare(owing(b)[0]?.dueDate ?? ''))
  const owedAll = mine.reduce((n, s) => n + stillOwed(s), 0)
  const lateAll = mine.reduce((n, s) => n + overdue(s).reduce((m, i) => m + i.amount, 0), 0)

  const needle = q.trim().toLowerCase()
  const match = (s: Sale) =>
    !needle || `${company(s.customerId)} ${fmtNum(s.volumeLiters)} ${s.clientPoReferenceNo ?? ''}`
      .toLowerCase().includes(needle)
  const rows = (tab === 'owed' ? owed : tab === 'all' ? mine : []).filter(match)
  const parkedRows = parked.filter((r) => !needle || (r.summary ?? '').toLowerCase().includes(needle))
  const { visible, more } = useFieldWindow(rows)

  if (mine.length === 0 && parked.length === 0) {
    return (
      <>
        <FieldHeader title="My sales" />
        <FieldBody>
          <FieldEmpty>No sales recorded yet.</FieldEmpty>
        </FieldBody>
        <Fab onClick={onNew} icon={<Plus size={17} strokeWidth={2.4} />} label="New sale" />
      </>
    )
  }

  /** The one line under a customer on the Outstanding tab: when the money is
   *  due, as a tag only when that is soon or already passed. */
  const dueLine = (s: Sale) => {
    const late = overdue(s)[0]
    if (late) return <Pill tone="act" text={`Overdue ${daysBetween(late.dueDate, today)} d`} />
    const due = owing(s)[0]
    if (!due) return null
    const days = daysBetween(today, due.dueDate)
    if (days <= 7) return <Pill tone="watch" text={days === 0 ? 'Due today' : `Due in ${days} d`} />
    return `Due ${fmtDayMonth(due.dueDate)}`
  }

  /** The status tag on the All tab. Red only when money is late, green when
   *  it is all in; the rest is the sale's own status, quietly. */
  const statusTag = (s: Sale) => {
    if (overdue(s).length > 0) return <Pill tone="act" text="Overdue" />
    if (s.installments.length > 0 && stillOwed(s) === 0) return <Pill tone="good" text="Paid" />
    return <Pill text={label(s.status)} />
  }

  return (
    <>
      <FieldHeader
        title="My sales"
        searching={searching}
        onSearch={() => { setSearching((v) => !v); setQ('') }}
        search={{ value: q, onChange: setQ, placeholder: 'Customer, litres or PO no.' }}
      />

      {/* The three figures an agent opens the app for, in view before any tab
          is touched: what is owed, what is late, what the office still holds. */}
      <FieldBody className="!pt-[14px] !pb-0">
        <SummaryStrip
          cells={[
            { label: 'Outstanding', value: owedAll, format: fmtCurrencyShort },
            { label: 'Overdue', value: lateAll, format: fmtCurrencyShort, tone: lateAll > 0 ? 'act' : 'mut' },
            { label: 'Pending', value: parked.length, format: Math.round, tone: 'mut' },
          ]}
        />
      </FieldBody>

      <FieldTabs
        value={tab}
        onChange={(t) => { onTab(t); setQ(''); setSearching(false) }}
        tabs={[
          { key: 'owed', label: 'Outstanding', count: owed.length },
          { key: 'waiting', label: 'Pending', count: parked.length },
          { key: 'all', label: 'All', count: mine.length },
        ]}
      />

      <FieldBody className="!pt-[14px] pb-[76px]">
        {tab === 'waiting' ? (
          parkedRows.length === 0 ? (
            <FieldEmpty>
              {needle ? `No results for “${q}”.` : 'No submissions pending approval.'}
            </FieldEmpty>
          ) : (
            <CardList>
              {parkedRows.map((r) => (
                // Not a record yet, so nothing to open: no chevron, no figure.
                <CompactRow
                  key={r.id}
                  title={r.summary ?? 'Sale'}
                  sub={`Submitted ${fmtDayMonth(r.requestedAt)}`}
                  valueSub={<Pill tone="watch" text="Pending" />}
                />
              ))}
            </CardList>
          )
        ) : rows.length === 0 ? (
          <FieldEmpty>
            {needle ? `No results for “${q}”.` : 'No outstanding balances. All sales are settled.'}
          </FieldEmpty>
        ) : (
          <>
            {/* Keyed so a new slice of the list rises in rather than
                swapping in place. */}
            <CardList key={`${tab}:${needle}`}>
              {visible.map((s) => tab === 'owed'
                ? (
                  <CompactRow
                    key={s.id}
                    title={company(s.customerId)}
                    sub={dueLine(s)}
                    value={peso(stillOwed(s))}
                    // A partly paid sale says what the balance is a balance of.
                    valueSub={stillOwed(s) < totalOf(s) ? `of ${peso(totalOf(s))}` : undefined}
                    tone={overdue(s).length > 0 ? 'act' : 'plain'}
                    onOpen={() => onOpen(s.id)}
                  />
                )
                : (
                  <CompactRow
                    key={s.id}
                    title={company(s.customerId)}
                    sub={`${fmtDayMonth(s.date)} · ${fmtNum(s.volumeLiters)} L`}
                    value={peso(totalOf(s))}
                    valueSub={statusTag(s)}
                    onOpen={() => onOpen(s.id)}
                  />
                ))}
            </CardList>
            {more}
          </>
        )}
      </FieldBody>

      <Fab onClick={onNew} icon={<Plus size={17} strokeWidth={2.4} />} label="New sale" />
    </>
  )
}

/** Whole days from one yyyy-MM-dd (or ISO) date to another. */
const daysBetween = (from: string, to: string) =>
  Math.max(0, Math.round((Date.parse(dayISO(to)) - Date.parse(dayISO(from))) / 86_400_000))

/** One sale, read-only: what was sold, and where the money is. */
function SaleSheet({ sale, company, depot, product, bank, onBack }: {
  sale: Sale
  company: string
  depot?: string
  product?: string
  bank?: BankAccount
  onBack: () => void
}) {
  const today = todayISO()
  return (
    <>
      <SheetHeader
        back={onBack}
        pill={<Pill text={label(sale.status)} tone={sale.status === 'fulfilled' ? 'good' : 'plain'} />}
        title={company}
        sub={`Recorded ${fmtDate(sale.date)}`}
      />

      <FieldBody>
        <Card lead>
          <BigFigure
            label="Sale total"
            value={peso(totalOf(sale))}
            sub={`${fmtNum(sale.volumeLiters)} L at ₱${sale.pricePerLiter.toFixed(2)} per litre`}
          />
        </Card>

        <FieldSectionLabel>Order</FieldSectionLabel>
        <Card>
          <IconRow icon={<Warehouse size={15} strokeWidth={1.8} />}>
            {depot ?? 'Depot not set'}{product ? ` · ${product}` : ''}
          </IconRow>
          <IconRow icon={<ArrowRight size={15} strokeWidth={1.8} />}>
            {sale.fulfillment === 'pickup' ? 'Pick up' : 'Delivery'}
            {sale.scheduleDate ? ` · ${fmtDate(sale.scheduleDate)}` : ' · not scheduled'}
            {sale.scheduleTime ? ` · ${sale.scheduleTime}` : ''}
          </IconRow>
          <IconRow icon={<Banknote size={15} strokeWidth={1.8} />}>
            {label(sale.paymentMode)}{bank ? ` · ${bank.bankName} ${bank.accountNumberMasked}` : ''}
          </IconRow>
          {sale.clientPoReferenceNo && (
            <IconRow icon={<span className="font-meta text-[12px] font-semibold">PO</span>}>
              {sale.clientPoReferenceNo}
            </IconRow>
          )}
        </Card>

        <FieldSectionLabel>Collection</FieldSectionLabel>
        <CardList>
          {sale.installments.map((i, n) => {
            const late = i.status === 'pending' && dayISO(i.dueDate) < today
            return (
              <FieldRow
                key={i.id}
                day={i.dueDate}
                title={peso(i.amount)}
                meta={sale.installments.length > 1 ? `Installment ${n + 1} of ${sale.installments.length}` : 'Single payment'}
                need={late ? 'Overdue' : undefined}
                note={!late ? label(i.status) : undefined}
                right={isSettled(i.status) ? <Pill text="Paid" tone="good" />
                  : wasCollected(i.status) ? <Pill text="Clearing" tone="watch" /> : undefined}
              />
            )
          })}
        </CardList>
      </FieldBody>
    </>
  )
}

type WhenChoice = 'today' | 'tomorrow' | 'other'

/**
 * Recording a sale from the roadside.
 *
 * The desktop form asks for eighteen things across five navigated sections.
 * This asks for the eight a sale cannot be written without, takes the total the
 * customer agreed rather than a price per litre (which is what gets typed wrong
 * on a phone), and docks that total to the bottom of the screen - the figure
 * being committed stays in view while the form is filled in, instead of living
 * below the fold from every field that changes it.
 *
 * Everything it does not ask - the collector, a multi-payment plan, the PO
 * attachment - is the office's to add on approval, which is where this is going
 * anyway.
 */
function NewSale({ agentId, customers, warehouses, bankAccounts, products, onDone }: {
  agentId: string
  customers: Customer[]
  warehouses: Depot[]
  bankAccounts: BankAccount[]
  products: Parameters<typeof productOptions>[0]
  /** `true` when a sale was actually filed, so the list can land on it. */
  onDone: (recorded?: boolean) => void
}) {
  const toast = useToast()
  const [saving, setSaving] = useState(false)
  const [showProblems, setShowProblems] = useState(false)
  const [f, setF] = useState({
    customerId: '',
    productId: '',
    warehouseId: warehouses.length === 1 ? warehouses[0].id : '',
    volume: '',
    total: '',
    fulfillment: 'delivery' as Sale['fulfillment'],
    when: 'tomorrow' as WhenChoice,
    otherDate: addDaysISO(todayISO(), 2),
    paymentMode: 'bank_transfer' as Sale['paymentMode'],
    bankAccountId: bankAccounts.length === 1 ? bankAccounts[0].id : '',
    dueDate: '',
    poRef: '',
  })
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }))

  const volume = Number(f.volume) || 0
  const total = Number(f.total) || 0
  const perLitre = volume > 0 ? total / volume : 0
  const customer = customers.find((c) => c.id === f.customerId)
  const scheduleDate = f.when === 'today' ? todayISO() : f.when === 'tomorrow' ? addDaysISO(todayISO(), 1) : f.otherDate

  // The customer's own standing term decides when this is due, as it does on
  // the desktop form - typed only when the agent disagrees with it.
  const defaultDue = useMemo(
    () => (f.paymentMode === 'cash' ? todayISO() : addDaysISO(todayISO(), customer?.paymentTermDays ?? 15)),
    [f.paymentMode, customer?.paymentTermDays],
  )
  const dueDate = f.dueDate || defaultDue

  const problems: Record<string, string> = {}
  if (!f.customerId) problems.customerId = 'Select a customer.'
  if (!f.warehouseId) problems.warehouseId = 'Select a depot.'
  if (volume <= 0) problems.volume = 'Enter the volume in litres.'
  if (total <= 0) problems.total = 'Enter the total price.'
  if (f.paymentMode === 'bank_transfer' && !f.bankAccountId) problems.bankAccountId = 'Select the receiving account.'
  const problem = (k: string) => (showProblems ? problems[k] : undefined)
  const missing = Object.keys(problems).length

  async function save() {
    setShowProblems(true)
    if (missing > 0) return
    setSaving(true)
    try {
      const result = await repos.sales.add({
        agentId,
        customerId: f.customerId,
        productId: f.productId || undefined,
        date: new Date(todayISO()).toISOString(),
        volumeLiters: volume,
        pricePerLiter: Math.round(perLitre * 100) / 100,
        warehouseId: f.warehouseId,
        fulfillment: f.fulfillment,
        scheduleDate: new Date(scheduleDate).toISOString(),
        paymentMode: f.paymentMode,
        bankAccountId: f.paymentMode === 'bank_transfer' ? f.bankAccountId : undefined,
        clientPoReferenceNo: f.poRef.trim() || undefined,
        installments: [{
          id: nanoid(8),
          principal: Math.round(total * 100) / 100,
          interestPct: 0,
          amount: Math.round(total * 100) / 100,
          dueDate: new Date(dueDate).toISOString(),
          status: 'pending' as const,
        }],
        status: 'draft' as const,
      })
      // The expected outcome, not an error: an agent's sale is a submission.
      toast(isPending(result) ? result.message : 'Sale recorded.')
      onDone(true)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Unable to record this sale.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <SheetHeader
        back={() => onDone()}
        title="New sale"
        sub={customer?.company ?? 'Submitted to the office for approval'}
      />

      <FieldBody>
        <FieldSectionLabel>Order</FieldSectionLabel>
        <Card>
          <FieldField label="Customer" error={problem('customerId')}>
            <FieldSelect value={f.customerId} onChange={(e) => set('customerId', e.target.value)}>
              <option value="">Select…</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.company}</option>)}
            </FieldSelect>
          </FieldField>

          {hasCatalog(products) && (
            <FieldField label="Product">
              <FieldSelect value={f.productId} onChange={(e) => set('productId', e.target.value)}>
                {productOptions(products).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </FieldSelect>
            </FieldField>
          )}

          <FieldField label="Depot" error={problem('warehouseId')}>
            <FieldSelect value={f.warehouseId} onChange={(e) => set('warehouseId', e.target.value)}>
              <option value="">Select…</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </FieldSelect>
          </FieldField>

          <div className="mb-[14px] flex gap-[10px]">
            <span className="flex-1">
              <FieldField label="Litres" error={problem('volume')}>
                <FieldInput
                  type="number"
                  inputMode="decimal"
                  value={f.volume}
                  placeholder="0"
                  onChange={(e) => set('volume', e.target.value)}
                />
              </FieldField>
            </span>
            <span className="flex-1">
              <FieldField label="Total price" error={problem('total')}>
                <FieldInput
                  type="number"
                  inputMode="decimal"
                  value={f.total}
                  placeholder="0"
                  onChange={(e) => set('total', e.target.value)}
                />
              </FieldField>
            </span>
          </div>
          {/* Derived, so the agent can check the rate they quoted without doing
              the division on the same phone they are typing into. */}
          <p className="tnum m-0 font-meta text-[13px] text-mut">
            {volume > 0 && total > 0 ? `₱${perLitre.toFixed(2)} per litre` : 'Price per litre is calculated from volume and total.'}
          </p>
        </Card>

        <FieldSectionLabel>Fulfillment</FieldSectionLabel>
        <Card>
          <FieldField label="Method">
            <FieldChoice
              value={f.fulfillment}
              onChange={(v) => set('fulfillment', v)}
              options={[{ value: 'delivery', label: 'Delivery' }, { value: 'pickup', label: 'Pick-up' }]}
            />
          </FieldField>
          <FieldField label="Schedule">
            <FieldChoice
              value={f.when}
              onChange={(v) => set('when', v)}
              options={[
                { value: 'today', label: 'Today' },
                { value: 'tomorrow', label: 'Tomorrow' },
                { value: 'other', label: 'Select date' },
              ]}
            />
          </FieldField>
          {f.when === 'other' && (
            <FieldField label="Date">
              <FieldInput type="date" value={f.otherDate} onChange={(e) => set('otherDate', e.target.value)} />
            </FieldField>
          )}
        </Card>

        <FieldSectionLabel>Payment</FieldSectionLabel>
        <Card>
          <FieldField label="Payment method">
            <FieldChoice
              value={f.paymentMode}
              onChange={(v) => set('paymentMode', v)}
              options={[
                { value: 'cash', label: 'Cash' },
                { value: 'check', label: 'Cheque' },
                { value: 'bank_transfer', label: 'Bank transfer' },
              ]}
            />
          </FieldField>

          {f.paymentMode === 'bank_transfer' && (
            <FieldField label="Receiving account" error={problem('bankAccountId')}>
              <FieldSelect value={f.bankAccountId} onChange={(e) => set('bankAccountId', e.target.value)}>
                <option value="">Select…</option>
                {bankAccounts.map((b) => (
                  <option key={b.id} value={b.id}>{b.bankName} · {b.accountNumberMasked}</option>
                ))}
              </FieldSelect>
            </FieldField>
          )}

          <FieldField
            label="Payment due"
            hint={f.dueDate ? undefined : customer
              ? `Based on the customer’s ${customer.paymentTermDays}-day payment term.`
              : 'Defaults to the customer’s payment term.'}
          >
            <FieldInput type="date" value={dueDate} onChange={(e) => set('dueDate', e.target.value)} />
          </FieldField>

          <FieldField label="Client PO no." hint="Optional">
            <FieldInput
              value={f.poRef}
              placeholder="PO reference"
              onChange={(e) => set('poRef', e.target.value)}
            />
          </FieldField>
        </Card>

        <Dock
          summary={{
            label: volume > 0 && total > 0 ? `${fmtNum(volume)} L at ₱${perLitre.toFixed(2)}` : 'Total',
            value: total > 0 ? peso(total) : '—',
          }}
          gap={showProblems && missing > 0
            ? `${missing} required ${missing === 1 ? 'field is' : 'fields are'} missing.`
            : undefined}
        >
          {/* The figure being committed is on the button itself: the last thing
              read before the tap is the amount. */}
          <Action onClick={save} disabled={saving}>
            {total > 0 ? `Record sale · ${peso(total)}` : 'Record sale'}
          </Action>
        </Dock>
      </FieldBody>
    </>
  )
}

/**
 * A seat that can reach this screen but cannot file anything from it.
 *
 * `Sale.agentId` points at an Agent record; a login points at a Personnel
 * record; `Personnel.agentId` is the bridge. A sales seat whose employee has no
 * agent behind them would have every sale refused by the server for not being
 * theirs - so it is said here, in the one place it matters, rather than
 * discovered when Save fails.
 */
function NoAgentSeat({ onBack }: { onBack: () => void }) {
  return (
    <>
      <SheetHeader back={onBack} title="New sale" />
      <FieldBody>
        <div className="rounded-[14px] border border-redf bg-redbadge px-[16px] py-[14px]">
          <p className="m-0 text-[15px] font-semibold text-redtext">This seat is not linked to a sales agent record.</p>
          <p className="m-0 mt-[6px] font-meta text-[13px] leading-[1.45] text-redtext">
            Sales cannot be recorded until an administrator links this seat to an agent under Settings → Seats.
          </p>
        </div>
      </FieldBody>
    </>
  )
}
