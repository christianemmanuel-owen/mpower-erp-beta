import { useEffect, useState } from 'react'
import { Printer } from 'lucide-react'
import {
  ChoiceCard, Choices, Field, GhostButton, Input, PrimaryButton, Select, Step, Dialog,
} from '../../components/ui'
import { RailAside, RailClose, RailRow, RailSection } from '../../components/SummaryRail'
import DocumentUpload from '../../components/DocumentUpload'
import PaymentPath from '../../components/PaymentPath'
import { allocateReference } from '../../lib/attachments'
import { printDocument } from '../../lib/printDoc'
import { fmtCurrency, fmtDate, label } from '../../lib/format'
import { daysLate } from '../../lib/credit'
import { bouncedFor, bouncedNote } from '../../lib/bouncedChecks'
import { installmentBankAccount, installmentCollector } from '../../lib/metrics'
import type {
  BankAccount, CollectionStatus, Customer, Personnel, Sale, SaleInstallment,
} from '../../data/types'

/**
 * Settling one collection - Exhibit A 1.6.
 *
 * Marking money collected used to be a single click. The spec asks for more
 * around that click: the reference number of the deposit slip or check, the
 * receiving bank account, the person in charge, and - when it went wrong - a
 * reason. Those are the fields that make a collection auditable months later,
 * and none of them can be recovered afterwards from a status alone.
 *
 * The outcome is four cards rather than a dropdown, because each one does
 * something different to the account's credit history and the collector's
 * rate, and a dropdown hides three of the four consequences at any moment.
 * `bounced` is first-class among them: a post-dated check that bounces is a
 * specific, recurring event here - the money was promised, presented and
 * refused - and it counts against both, which a plain "still pending" would
 * not. The rail says what this settlement does before it is saved, including
 * what the customer's bounced checks already add up to in law.
 */

const STATUS_OPTIONS: ReadonlyArray<{
  value: CollectionStatus
  label: string
  hint: string
  tone?: 'bad'
}> = [
  // "Collected" is a custody fact, not a money fact: the collector has it.
  // Banking it is Treasury's, and until the bank pays out the customer
  // still owes it - which is why this no longer says "the money arrived".
  { value: 'collected', label: 'Collected', hint: 'Received from the customer.' },
  { value: 'bounced', label: 'Bounced', hint: 'A check was presented and refused.', tone: 'bad' },
  { value: 'pending', label: 'Still pending', hint: 'Not collected yet - say why below.' },
  { value: 'cancelled', label: 'Cancelled', hint: 'No longer collectable.' },
]

export default function SettleDialog({
  entry, sales, customers, personnel, bankAccounts, onClose, onSave, onNotice, readOnly = false,
}: {
  /** A seat outside Collect looking at a collection - a treasurer from the
   *  calendar. Disabled throughout; the footer only closes. */
  readOnly?: boolean
  /**
   * The installment to settle, and optionally the outcome to open on - set
   * when the dialog was reached by dragging a card into a column, so the drop
   * you made is the choice already selected when the form appears.
   */
  entry: { sale: Sale; installment: SaleInstallment; preset?: CollectionStatus } | null
  /** Every sale, for the customer's bounced-check history. */
  sales: Sale[]
  customers: Customer[]
  personnel: Personnel[]
  bankAccounts: BankAccount[]
  onClose: () => void
  onSave: (saleId: string, installmentId: string, patch: Partial<SaleInstallment>) => Promise<void>
  onNotice: (message: string) => void
}) {
  const [status, setStatus] = useState<CollectionStatus>('collected')
  const [referenceNo, setReferenceNo] = useState('')
  const [notes, setNotes] = useState('')
  const [collectorId, setCollectorId] = useState('')
  const [bankAccountId, setBankAccountId] = useState('')
  const [collectedOn, setCollectedOn] = useState('')
  const [checkOn, setCheckOn] = useState('')
  const [formNo, setFormNo] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!entry) return
    const { sale, installment, preset } = entry
    setStatus(preset ?? (installment.status === 'pending' ? 'collected' : installment.status))
    setReferenceNo(installment.referenceNo ?? '')
    setNotes(installment.notes ?? '')
    setCollectorId(installmentCollector(sale, installment) ?? '')
    setBankAccountId(installmentBankAccount(sale, installment) ?? '')
    setCollectedOn((installment.collectedAt ?? new Date().toISOString()).slice(0, 10))
    // Defaults to the due date, which is what a post-dated check is normally
    // written for, but it is the collector's to correct from the check in
    // front of them - it decides when Treasury may bank it.
    setCheckOn((installment.checkDate ?? installment.dueDate).slice(0, 10))
    setFormNo(installment.collectionFormNo ?? '')
    setError(null)
  }, [entry])

  if (!entry) return null
  const { sale, installment } = entry
  const customer = customers.find((c) => c.id === sale.customerId)
  /** Nothing to hold or present: received is settled. */
  const oneStep = sale.paymentMode === 'bank_transfer'

  // Collection details come from the account's collection contact point, which
  // Exhibit A 1.4 keeps separate from the office and delivery addresses.
  const collectionPoint = customer?.collection
  const collectAddress = collectionPoint?.address || customer?.collectionAddress || customer?.address || '—'
  const collectPerson = collectionPoint?.contactPerson || customer?.contactPerson || '—'
  const collectNumber = collectionPoint?.contactNumber || customer?.contactNumber || '—'

  // Preview of how this will land in the collector's on-time rate, computed the
  // same way collectionRate() will once it is saved.
  const late = status === 'collected' && collectedOn
    ? daysLate({ ...installment, status: 'collected', collectedAt: new Date(collectedOn).toISOString() })
    : null

  // What this customer's bounced checks already come to - worth knowing while
  // recording another one, or while deciding to take a replacement check.
  const bounced = bouncedFor(sale.customerId, sales)
  // With this one added, if it is the one being recorded now.
  const withThis = installment.status !== 'bounced' && status === 'bounced'
    ? { ...bounced, count: bounced.count + 1, total: bounced.total + installment.amount }
    : bounced
  const bouncedLine = bouncedNote(withThis)

  async function save() {
    if (!entry) return
    if (status === 'collected' && !collectedOn) {
      setError('Record the date the money arrived - the on-time figure is built on it.')
      return
    }
    // Every outcome that isn't money arriving owes an explanation. A bounce
    // and a cancellation both leave a mark on the account - one on its credit
    // history, one on what it was ever going to pay - and a year later the
    // status alone says nothing about either.
    if (status !== 'collected' && !notes.trim()) {
      setError(status === 'bounced'
        ? 'Give a reason for the bounce - it is what explains the account’s credit history later.'
        : status === 'cancelled'
          ? 'Give a reason - a written-off receivable with no explanation can’t be defended later.'
          : 'Say why this hasn’t been collected yet.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onSave(sale.id, installment.id, {
        // A bank transfer is money the moment it lands - there is no paper for
        // Treasury to bank - so recording one settles it outright. Cash and
        // checks are in the collector's hands and go to Treasury. The
        // clearing timestamp is deliberately not written here: it is
        // Treasury's field, and a one-step receipt is dated by its collection.
        status: status === 'collected' && oneStep ? 'cleared' : status,
        // Cleared when the outcome is no longer "collected", so a corrected
        // mistake doesn't leave a collection date on an uncollected payment.
        collectedAt: status === 'collected' ? new Date(collectedOn).toISOString() : undefined,
        checkDate: status === 'collected' && sale.paymentMode === 'check' && checkOn
          ? new Date(checkOn).toISOString()
          : undefined,
        referenceNo: referenceNo.trim() || undefined,
        notes: notes.trim() || undefined,
        collectorId: collectorId || undefined,
        bankAccountId: bankAccountId || undefined,
        collectionFormNo: formNo || undefined,
      })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t save this collection.')
    } finally {
      setBusy(false)
    }
  }

  /** Exhibit A 1.6 - the collection form, as a printable PDF. */
  async function printForm() {
    let no = formNo
    if (!no) {
      setBusy(true)
      try {
        no = await allocateReference('CF')
        setFormNo(no)
      } catch (e) {
        onNotice(e instanceof Error ? e.message : 'Couldn’t allocate a collection form number.')
        return
      } finally {
        setBusy(false)
      }
    }

    const solicitor = personnel.find((p) => p.id === collectorId)
    const bank = bankAccounts.find((b) => b.id === bankAccountId)

    const ok = printDocument(
      { title: 'Collection form', referenceNo: no, date: installment.dueDate },
      [
        {
          kind: 'fields',
          cells: [
            { label: 'Company name', value: customer?.company ?? '—' },
            { label: 'Address', value: collectAddress },
            { label: 'Contact person', value: collectPerson },
            { label: 'Contact number', value: collectNumber },
            { label: 'Volume', value: `${sale.volumeLiters.toLocaleString()} L` },
            { label: 'Amount', value: fmtCurrency(installment.amount) },
            { label: 'Mode of payment', value: label(sale.paymentMode) },
            { label: 'Due date', value: fmtDate(installment.dueDate) },
            { label: 'Receiving bank account', value: bank ? `${bank.bankName} ${bank.accountNumberMasked}` : '—' },
            { label: 'Reference number', value: referenceNo || '—' },
            { label: 'Solicitor', value: solicitor?.name ?? '—' },
            { label: 'Solicitor contact', value: solicitor?.contactNumber ?? '—' },
          ],
        },
        ...(notes.trim() ? [{ kind: 'note' as const, text: notes.trim() }] : []),
        {
          kind: 'signatures',
          signatories: [
            { role: 'Received by (MPower)', name: solicitor?.name },
            { role: 'Released by (client)', name: collectPerson === '—' ? undefined : collectPerson },
          ],
        },
      ],
    )
    if (!ok) onNotice('Your browser blocked the print window - allow pop-ups for this site and try again.')
  }

  const money = status === 'collected'
  return (
    <Dialog
      open
      title="Collection"
      subtitle={`${customer?.company ?? '—'} · ${fmtCurrency(installment.amount)} · due ${fmtDate(installment.dueDate)}`}
      onClose={onClose}
      width={860}
      rail={
        <>
          {/* A receipt, not a commentary: the figures, then one closing line
              saying what Save does, then the one fact that judges it. The
              sentences this replaces said the same things in prose and left
              the reader to find the number inside them. */}
          <RailSection title="This collection">
            <RailRow label="Amount" value={fmtCurrency(installment.amount)} />
            <RailRow label="Due" value={fmtDate(installment.dueDate)} />
            <RailRow label="Mode" value={label(sale.paymentMode)} />
            <RailRow label="Collector" value={personnel.find((p) => p.id === collectorId)?.name ?? 'Unassigned'} />
            <RailClose
              label="On save"
              tone={status === 'bounced' ? 'bad' : 'plain'}
              value={money ? (oneStep ? 'Cleared' : 'In hand') : STATUS_OPTIONS.find((o) => o.value === status)?.label ?? '—'}
            />
            {money && late !== null && (
              <RailRow
                label="Timing"
                value={late > 0
                  ? <span className="font-semibold text-redtext">{late} day{late === 1 ? '' : 's'} late</span>
                  : <span className="text-greentext">On time</span>}
              />
            )}
            <PaymentPath
              status={money ? (oneStep ? 'cleared' : 'collected') : status}
              paymentMode={sale.paymentMode}
              size="sm"
              bracket={false}
              className="mt-[12px]"
            />
            {/* One line on what happens next, and only when something does. */}
            {money && !oneStep && (
              <RailAside>
                Treasury banks it next{sale.paymentMode === 'check' && checkOn ? `, from ${fmtDate(checkOn)}` : ''}. Stays on the customer’s balance until it clears.
              </RailAside>
            )}
            {status === 'bounced' && <RailAside tone="bad">Goes on the account’s credit history and the collector’s rate.</RailAside>}
          </RailSection>

          <RailSection title="Collect from">
            <p className="m-0 text-[13px] leading-[1.4] text-lab">{collectAddress}</p>
            <p className="m-0 mt-[2px] font-meta text-[12px] text-mut">{collectPerson} · {collectNumber}</p>
          </RailSection>

          {bouncedLine && (
            <RailSection title={withThis.count > bounced.count ? 'With this one' : 'Bounced checks on file'}>
              <RailRow label="Bounced" value={`${withThis.count} · ${fmtCurrency(withThis.total)}`} />
              <RailAside tone="bad">{bouncedLine}</RailAside>
            </RailSection>
          )}
        </>
      }
      footer={readOnly ? (
        <PrimaryButton onClick={onClose}>Close</PrimaryButton>
      ) : (
        <>
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</PrimaryButton>
        </>
      )}
    >
      <fieldset disabled={readOnly} className="contents [&:disabled_*]:cursor-default">
      {readOnly && (
        <p className="mb-4 rounded-[6px] border border-line bg-paper px-3 py-2 font-meta text-[12px] text-mut">
          Viewing only. Recording a collection is Collect’s work; banking it is done from Treasury.
        </p>
      )}
      {error && (
        <p className="mb-4 rounded-[8px] border border-redf bg-redbadge px-3 py-2 font-meta text-[12px] font-semibold text-redtext">{error}</p>
      )}

      <Step n={1} title="Outcome">
        <Choices>
          {STATUS_OPTIONS.map((o) => (
            <ChoiceCard
              key={o.value}
              on={status === o.value}
              onClick={() => setStatus(o.value)}
              title={o.label}
              note={o.hint}
              tone={o.tone}
            />
          ))}
        </Choices>
      </Step>

      {/* The paper trail, in one block: when the money arrived, what it came
          on, where it landed, and who carried it. A bank account only makes
          sense when something was actually received. */}
      <Step n={2} title={money ? 'Payment details' : 'Collection details'}>
        <div className="grid grid-cols-2 gap-x-4 gap-y-[14px]">
          {money && (
            <Field label="Date collected">
              <Input type="date" value={collectedOn} onChange={(e) => setCollectedOn(e.target.value)} />
            </Field>
          )}
          {/* The client's question - "due for collection or due for
              depositing?" - is two dates, and this is the second one. Taking a
              post-dated check today does not make it bankable today, and the
              treasury's queue is ordered by this, not by the date above. */}
          {money && sale.paymentMode === 'check' && (
            <Field label="Date on the check" hint="When Treasury may bank it.">
              <Input type="date" value={checkOn} onChange={(e) => setCheckOn(e.target.value)} />
            </Field>
          )}
          <Field
            label={sale.paymentMode === 'check' ? 'Check number' : 'Reference number'}
            optional={!money}
            hint={money ? undefined : 'The check or deposit slip this was meant to settle with.'}
          >
            <Input value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} placeholder="e.g. BPI-DS-887214" />
          </Field>
          {money && (
            <Field label="Receiving bank account" optional>
              <Select value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)}>
                <option value="">—</option>
                {bankAccounts.map((b) => (
                  <option key={b.id} value={b.id}>{b.bankName} {b.accountNumberMasked}</option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Person in charge">
            <Select value={collectorId} onChange={(e) => setCollectorId(e.target.value)}>
              <option value="">Unassigned</option>
              {personnel.filter((p) => p.active !== false).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </Field>
        </div>
      </Step>

      <Step n={3} title={money ? 'Notes' : 'Reason'} last>
        <Field
          label={money ? 'Notes' : 'Reason'}
          hideLabel
          hint={money
            ? 'Optional - anything worth knowing about this payment.'
            : 'Exhibit A asks for the reason behind every late or missed collection.'}
        >
          <Input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={
              status === 'bounced' ? 'e.g. Insufficient funds - client re-issuing'
                : status === 'cancelled' ? 'e.g. Written off after the account closed'
                : money ? 'e.g. Paid in two tranches, second one cleared today'
                : 'e.g. Cheque signatory out of office until Friday'
            }
          />
        </Field>

        {/* The paperwork, at the foot: the form that goes out with the
            collector, and the slips that come back. */}
        <div className="mt-[14px] flex items-center gap-3">
          <GhostButton onClick={printForm} disabled={busy} size="sm" className="gap-[6px]">
            <Printer size={13} strokeWidth={2} />
            {busy ? 'Working…' : formNo ? 'Reprint collection form' : 'Print collection form'}
          </GhostButton>
          {formNo && <span className="font-meta text-[12px] text-faint">Form {formNo}</span>}
        </div>
        <div className="mt-[10px]">
          <DocumentUpload tbl="sales" recordId={sale.id} slots={['depositSlip', 'checkImage', 'collectionForm']} />
        </div>
      </Step>
      </fieldset>
    </Dialog>
  )
}
