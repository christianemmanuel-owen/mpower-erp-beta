import { useState, type ReactNode } from 'react'
import { PhoneSkeleton } from '../../components/ui'
import PaymentPath from '../../components/PaymentPath'
import { Banknote, MapPin, Phone } from 'lucide-react'
import { useTables } from '../../lib/data'
import { repos } from '../../data/repo'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../components/Toast'
import { isPending } from '../../lib/approvals'
import { dayISO, fmtCurrency, fmtDate, fmtDayMonth, label, todayISO } from '../../lib/format'
import { installmentCollector } from '../../lib/metrics'
import { isInHand, isSettled, wasCollected } from '../../lib/collectionStatus'
import PhotoCapture from '../../components/PhotoCapture'
import {
  Action, BigFigure, CardList, CompactRow, Dock, FieldBody, FieldChoice, FieldEmpty, FieldField,
  FieldHeader, FieldInput, FieldSectionLabel, FieldTabs, IconRow, Pill, ScreenStack, SheetHeader,
  SummaryStrip, useFieldWindow,
} from './shell'
import type { Customer, Sale, SaleInstallment } from '../../data/types'

/**
 * The collector's screens: what to go and get, and what is in the bag.
 *
 * A collector spends the day out of the office with other people's money on
 * them, which is a different job from the agent's and the driver's and needs
 * its own screen for the same reason theirs do. The office asks who owes what;
 * a collector asks where am I going, how much am I asking for, and - the part
 * no screen showed before - what am I still carrying.
 *
 * That last question is why "In hand" is a tab rather than a detail. Under the
 * old model a collection was finished the moment it was recorded, so a check in
 * a collector's bag was indistinguishable from money in the bank, including to
 * the collector holding it. It is now a custody position they can see and hand
 * over, and Treasury is the other end of that handover.
 *
 * What is deliberately NOT here: depositing. A collector cannot bank their own
 * collection - that is the whole point of Treasury being a separate seat,
 * and the server refuses it per field rather than trusting this screen to hide
 * the button (see installmentWriteProblem in server/access.ts).
 */
type Tab = 'today' | 'hand' | 'done'

interface Entry { sale: Sale; installment: SaleInstallment }

export default function MyCollections() {
  const { seat } = useAuth()
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('today')
  const toast = useToast()
  const data = useTables(['sales', 'customers'] as const)
  if (!data) return <PhoneSkeleton />
  const { sales, customers } = data

  // The server already hands a scoped seat only the sales it collects on (see
  // server/scope.ts), but a sale can carry installments for two collectors, so
  // the rows are narrowed again by the installment's own resolved collector.
  const mine: Entry[] = sales
    .flatMap((sale) => sale.installments.map((installment) => ({ sale, installment })))
    .filter((e) => e.installment.status !== 'cancelled')
    .filter((e) => !seat?.personnelId || installmentCollector(e.sale, e.installment) === seat.personnelId)

  const company = (id: string) => customers.find((c) => c.id === id)?.company ?? 'Customer'
  const customerOf = (id: string) => customers.find((c) => c.id === id)

  async function record(saleId: string, installmentId: string, patch: Partial<SaleInstallment>) {
    const sale = sales.find((s) => s.id === saleId)
    if (!sale) return
    const result = await repos.sales.update(saleId, {
      installments: sale.installments.map((i) => (i.id === installmentId ? { ...i, ...patch } : i)),
    })
    if (isPending(result)) toast(result.message)
  }

  const stack = (screen: string, depth: number, node: ReactNode) =>
    <ScreenStack screen={screen} depth={depth}>{node}</ScreenStack>

  const open = mine.find((e) => `${e.sale.id}::${e.installment.id}` === openKey)
  if (open) {
    return stack(`collection:${openKey}`, 1,
      <CollectSheet
        entry={open}
        customer={customerOf(open.sale.customerId)}
        company={company(open.sale.customerId)}
        onBack={() => setOpenKey(null)}
        onSave={async (patch) => {
          await record(open.sale.id, open.installment.id, patch)
          setOpenKey(null)
          // Land on the tab it moved to, so the thing just done is visible
          // rather than somewhere the collector has to go and look for it.
          setTab(patch.status === 'collected' ? 'hand' : patch.status === 'cleared' ? 'done' : 'today')
        }}
      />,
    )
  }

  return stack('list', 0,
    <CollectionList rows={mine} company={company} tab={tab} onTab={setTab} onOpen={setOpenKey} />,
  )
}

const peso = (n: number) => fmtCurrency(n).replace('.00', '')

/**
 * The round, in three tabs.
 *
 * "To collect" is the work; "In hand" is the custody; "Banked" is the receipt.
 * Ordered by due date soonest first, which puts the overdue at the top - the
 * order somebody chasing money would put them in themselves.
 */
function CollectionList({ rows, company, tab, onTab, onOpen }: {
  rows: Entry[]
  company: (id: string) => string
  tab: Tab
  onTab: (t: Tab) => void
  onOpen: (key: string) => void
}) {
  const [q, setQ] = useState('')
  const [searching, setSearching] = useState(false)
  const today = todayISO()

  const due = rows.filter((e) => e.installment.status === 'pending')
    .sort((a, b) => a.installment.dueDate.localeCompare(b.installment.dueDate))
  const hand = rows.filter((e) => isInHand(e.installment.status))
    .sort((a, b) => (a.installment.collectedAt ?? '').localeCompare(b.installment.collectedAt ?? ''))
  const done = rows.filter((e) => isSettled(e.installment.status) || e.installment.status === 'deposited')
    .sort((a, b) => (b.installment.collectedAt ?? '').localeCompare(a.installment.collectedAt ?? ''))

  const sum = (list: Entry[]) => list.reduce((n, e) => n + e.installment.amount, 0)
  const lateAll = sum(due.filter((e) => dayISO(e.installment.dueDate) < today))

  const needle = q.trim().toLowerCase()
  const shown = (tab === 'today' ? due : tab === 'hand' ? hand : done)
    .filter((e) => !needle || company(e.sale.customerId).toLowerCase().includes(needle))
  const { visible, more } = useFieldWindow(shown)

  if (rows.length === 0) {
    return (
      <>
        <FieldHeader title="My collections" />
        <FieldBody><FieldEmpty>Nothing assigned to you yet.</FieldEmpty></FieldBody>
      </>
    )
  }

  /** The one line under a name: when it is due, or - once collected - what it
   *  is and what has to happen to it next. */
  const line = (e: Entry) => {
    const i = e.installment
    if (isInHand(i.status)) {
      return i.checkDate && dayISO(i.checkDate) > today
        ? `${label(e.sale.paymentMode)} · bankable ${fmtDayMonth(i.checkDate)}`
        : `${label(e.sale.paymentMode)} · hand to Treasury`
    }
    if (wasCollected(i.status)) {
      return i.status === 'deposited' ? 'At the bank' : `Cleared ${i.clearedAt ? fmtDayMonth(i.clearedAt) : ''}`.trim()
    }
    const d = dayISO(i.dueDate)
    if (d < today) return `Overdue · was ${fmtDayMonth(i.dueDate)}`
    if (d === today) return 'Due today'
    return `Due ${fmtDayMonth(i.dueDate)}`
  }

  /** Red is only for money that is late - the row's own rule, and the reason
   *  "in hand" is not coloured: it is a position, not a problem. */
  const tone = (e: Entry): 'plain' | 'act' =>
    e.installment.status === 'pending' && dayISO(e.installment.dueDate) < today ? 'act' : 'plain'

  return (
    <>
      <FieldHeader
        title="My collections"
        searching={searching}
        onSearch={() => setSearching((s) => !s)}
        search={{ value: q, onChange: setQ, placeholder: 'Find a customer…' }}
      />
      <FieldBody>
        {/* The two figures a collector is actually carrying around in their
            head: what is still to get, and what is on them right now. */}
        <SummaryStrip
          cells={[
            { label: 'To collect', value: sum(due), format: peso, tone: lateAll > 0 ? 'act' : 'plain' },
            { label: 'In hand', value: sum(hand), format: (n) => (n > 0 ? peso(n) : '—') },
          ]}
        />

        <FieldTabs
          value={tab}
          onChange={onTab}
          tabs={[
            { key: 'today' as Tab, label: 'To collect', count: due.length },
            { key: 'hand' as Tab, label: 'In hand', count: hand.length },
            { key: 'done' as Tab, label: 'Banked', count: done.length },
          ]}
        />

        {shown.length === 0 ? (
          <FieldEmpty>
            {tab === 'today' ? 'Nothing left to collect.'
              : tab === 'hand' ? 'Nothing in hand - everything has been handed over.'
                : 'Nothing banked yet.'}
          </FieldEmpty>
        ) : (
          <CardList>
            {visible.map((e) => (
              <CompactRow
                key={`${e.sale.id}::${e.installment.id}`}
                title={company(e.sale.customerId)}
                sub={line(e)}
                value={peso(e.installment.amount)}
                tone={tone(e)}
                onOpen={() => onOpen(`${e.sale.id}::${e.installment.id}`)}
              />
            ))}
          </CardList>
        )}
        {more}
      </FieldBody>
    </>
  )
}

/**
 * One collection, and the three things that can happen to it.
 *
 * The address and the phone number lead, because the first thing this screen is
 * for is getting there, and the second is ringing ahead. The form underneath is
 * the shortest it can be: what happened, when, and - for a check - the number
 * and the date on its face, which is what decides when Treasury may bank
 * it and is the one fact only the person holding the check can read.
 */
function CollectSheet({ entry, customer, company, onBack, onSave }: {
  entry: Entry
  customer: Customer | undefined
  company: string
  onBack: () => void
  onSave: (patch: Partial<SaleInstallment>) => Promise<void>
}) {
  const { sale, installment } = entry
  const settled = wasCollected(installment.status)
  const [outcome, setOutcome] = useState<'collected' | 'pending' | 'bounced'>('collected')
  const [on, setOn] = useState(todayISO())
  const [checkNo, setCheckNo] = useState(installment.referenceNo ?? '')
  const [checkOn, setCheckOn] = useState(dayISO(installment.checkDate ?? installment.dueDate))
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const point = customer?.collection
  const address = point?.address || customer?.collectionAddress || customer?.address
  const person = point?.contactPerson || customer?.contactPerson
  const number = point?.contactNumber || customer?.contactNumber
  const isCheck = sale.paymentMode === 'check'

  async function save() {
    if (outcome !== 'collected' && !notes.trim()) {
      setError(outcome === 'bounced'
        ? 'Say why it bounced.'
        : 'Say why you could not collect - it is what the office will ask.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onSave(outcome === 'collected'
        ? {
          // A transfer settles on receipt; cash and checks go to Treasury.
          status: sale.paymentMode === 'bank_transfer' ? 'cleared' : 'collected',
          collectedAt: new Date(on).toISOString(),
          referenceNo: isCheck ? checkNo.trim() || undefined : undefined,
          checkDate: isCheck && checkOn ? new Date(checkOn).toISOString() : undefined,
          notes: notes.trim() || undefined,
        }
        : { status: outcome, notes: notes.trim() })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <SheetHeader
        back={onBack}
        title={company}
        sub={`${label(sale.paymentMode)} · due ${fmtDate(installment.dueDate)}`}
        pill={settled
          ? <Pill text={isInHand(installment.status) ? 'In hand' : installment.status === 'deposited' ? 'At the bank' : 'Cleared'} tone={isSettled(installment.status) ? 'good' : 'watch'} />
          : dayISO(installment.dueDate) < todayISO() ? <Pill text="Overdue" tone="act" /> : undefined}
      />
      <FieldBody>
        <BigFigure
          label={isInHand(installment.status) ? 'In hand' : settled ? 'Amount' : 'To collect'}
          value={peso(installment.amount)}
        />
        {/* The whole road, so a collector sees that recording it as in hand
            hands it to Treasury rather than finishing it. */}
        <PaymentPath
          status={installment.status}
          paymentMode={sale.paymentMode}
          depositedAt={installment.depositedAt}
          desk="collection"
          size="sm"
          className="mb-[18px] mt-[14px]"
        />

        <FieldSectionLabel>Where to go</FieldSectionLabel>
        {/* Tappable: on a phone these are the two things this screen exists to
            make easy, and retyping an address into Maps at the wheel is not it. */}
        <div className="mb-[16px] flex flex-col gap-[10px]">
          <IconRow icon={<MapPin size={15} strokeWidth={2} />}>
            {address
              ? <a href={`geo:0,0?q=${encodeURIComponent(address)}`} className="text-ink no-underline">{address}</a>
              : <span className="text-faint">No collection address on file</span>}
          </IconRow>
          <IconRow icon={<Phone size={15} strokeWidth={2} />}>
            {number
              ? <a href={`tel:${number.replace(/\s/g, '')}`} className="text-ink no-underline">{number}{person ? ` · ${person}` : ''}</a>
              : <span className="text-faint">No contact number</span>}
          </IconRow>
        </div>

        {settled ? (
          <>
            <FieldSectionLabel>What happened</FieldSectionLabel>
            <div className="flex flex-col gap-[10px]">
              <IconRow icon={<Banknote size={15} strokeWidth={2} />}>
                Collected {installment.collectedAt ? fmtDate(installment.collectedAt) : ''}
                {installment.referenceNo ? ` · check ${installment.referenceNo}` : ''}
              </IconRow>
              {isInHand(installment.status) && (
                <p className="m-0 font-meta text-[13px] text-mut">
                  {installment.checkDate && dayISO(installment.checkDate) > todayISO()
                    ? `Post-dated to ${fmtDate(installment.checkDate)} - Treasury banks it from then.`
                    : 'Hand this to Treasury to be banked.'}
                </p>
              )}
            </div>
          </>
        ) : (
          <>
            <FieldSectionLabel>Record it</FieldSectionLabel>
            <FieldField label="What happened">
              <FieldChoice
                value={outcome}
                onChange={setOutcome}
                options={[
                  { value: 'collected' as const, label: 'Collected' },
                  { value: 'pending' as const, label: 'Not yet' },
                  { value: 'bounced' as const, label: 'Bounced' },
                ]}
              />
            </FieldField>

            {outcome === 'collected' && (
              <>
                <FieldField label="Date collected">
                  <FieldInput type="date" value={on} onChange={(e) => setOn(e.target.value)} />
                </FieldField>
                {isCheck && (
                  <>
                    <FieldField label="Check number">
                      <FieldInput
                        value={checkNo}
                        onChange={(e) => setCheckNo(e.target.value)}
                        placeholder="e.g. BPI-887214"
                      />
                    </FieldField>
                    {/* The one fact only the person holding the check can read,
                        and the one that decides when it can be banked. */}
                    <FieldField label="Date on the check" hint="When the office can deposit it.">
                      <FieldInput type="date" value={checkOn} onChange={(e) => setCheckOn(e.target.value)} />
                    </FieldField>
                  </>
                )}
                {/* Filed under what it actually is, so the office finds it
                    where it expects to: the check itself for a check, the
                    deposit slip or receipt for anything else. */}
                <FieldField
                  label={isCheck ? 'Photo of the check' : 'Photo of the receipt'}
                  hint="So the office has it before you get back."
                >
                  <PhotoCapture
                    tbl="sales"
                    recordId={sale.id}
                    slot={isCheck ? 'checkImage' : 'depositSlip'}
                  />
                </FieldField>
              </>
            )}

            <FieldField
              label={outcome === 'collected' ? 'Notes' : 'Reason'}
              hint={outcome === 'collected' ? 'Optional.' : undefined}
              error={error ?? undefined}
            >
              <FieldInput
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={outcome === 'collected'
                  ? 'Anything the office should know'
                  : outcome === 'bounced' ? 'e.g. Insufficient funds' : 'e.g. Signatory out until Friday'}
              />
            </FieldField>
          </>
        )}

      {/* Inside the body, like the other screens' docks: the dock pulls
          itself out to the edges by the body's padding, so outside it it
          hung 18px past both sides and the amount was cut off. */}
      {!settled && (
        <Dock summary={{ label: 'Amount', value: peso(installment.amount) }}>
          <Action onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Action>
        </Dock>
      )}
      </FieldBody>
    </>
  )
}
