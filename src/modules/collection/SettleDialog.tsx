import { useEffect, useState } from 'react'
import {
  Field, FormSection, GhostButton, Input, PrimaryButton, SectionLabel, Select, Dialog,
} from '../../components/ui'
import DocumentUpload from '../../components/DocumentUpload'
import { allocateReference } from '../../lib/attachments'
import { printDocument } from '../../lib/printDoc'
import { fmtCurrency, fmtDate, label } from '../../lib/format'
import { daysLate } from '../../lib/credit'
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
 * `bounced` is a first-class outcome here rather than a variety of "not
 * collected". A post-dated check that bounces is a specific, recurring event in
 * this business: the money was promised, presented, and refused. It counts
 * against the account's credit history and the collector's rate, which a plain
 * "still pending" would not.
 */

const STATUS_OPTIONS: ReadonlyArray<{ value: CollectionStatus; label: string; hint: string }> = [
  { value: 'collected', label: 'Collected', hint: 'The money arrived.' },
  { value: 'bounced', label: 'Bounced', hint: 'A post-dated check was presented and refused. Counts against the account and the collector.' },
  { value: 'pending', label: 'Still pending', hint: 'Not collected yet - record why below.' },
  { value: 'cancelled', label: 'Cancelled', hint: 'No longer collectable. Excluded from collection performance entirely.' },
]

export default function SettleDialog({
  entry, customers, personnel, bankAccounts, onClose, onSave, onNotice,
}: {
  entry: { sale: Sale; installment: SaleInstallment } | null
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
  const [formNo, setFormNo] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!entry) return
    const { sale, installment } = entry
    setStatus(installment.status === 'pending' ? 'collected' : installment.status)
    setReferenceNo(installment.referenceNo ?? '')
    setNotes(installment.notes ?? '')
    setCollectorId(installmentCollector(sale, installment) ?? '')
    setBankAccountId(installmentBankAccount(sale, installment) ?? '')
    setCollectedOn((installment.collectedAt ?? new Date().toISOString()).slice(0, 10))
    setFormNo(installment.collectionFormNo ?? '')
    setError(null)
  }, [entry])

  if (!entry) return null
  const { sale, installment } = entry
  const customer = customers.find((c) => c.id === sale.customerId)
  const chosen = STATUS_OPTIONS.find((o) => o.value === status)

  // Collection details come from the account's collection contact point, which
  // Exhibit A 1.4 keeps separate from the office and delivery addresses.
  const collectionPoint = customer?.collection
  const collectAddress = collectionPoint?.address || customer?.collectionAddress || customer?.address || '—'
  const collectPerson = collectionPoint?.contactPerson || customer?.contactPerson || '—'
  const collectNumber = collectionPoint?.contactNumber || customer?.contactNumber || '—'

  // Preview of how this will land in the collector's on-time rate, computed the
  // same way collectionRate() will once it is saved.
  const preview = status === 'collected' && collectedOn
    ? daysLate({ ...installment, status: 'collected', collectedAt: new Date(collectedOn).toISOString() })
    : null

  async function save() {
    if (!entry) return
    if (status === 'collected' && !collectedOn) {
      setError('Record the date the money arrived - the on-time figure is built on it.')
      return
    }
    if (status === 'bounced' && !notes.trim()) {
      setError('Give a reason for the bounce - it is what explains the account’s credit history later.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onSave(sale.id, installment.id, {
        status,
        // Cleared when the outcome is no longer "collected", so a corrected
        // mistake doesn't leave a collection date on an uncollected payment.
        collectedAt: status === 'collected' ? new Date(collectedOn).toISOString() : undefined,
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

  return (
    <Dialog
      open
      title="Collection"
      onClose={onClose}
      width={620}
      footer={
        <>
          <div className="flex-1">
            <SectionLabel>Amount</SectionLabel>
            <p className="tnum m-0 mt-[2px] text-[20px] font-semibold">{fmtCurrency(installment.amount)}</p>
          </div>
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton onClick={save}>{busy ? 'Saving…' : 'Save'}</PrimaryButton>
        </>
      }
    >
      {error && (
        <p className="mb-3 rounded-[6px] border border-redf bg-redbadge px-3 py-2 text-[13px] font-semibold text-redtext">{error}</p>
      )}

      <p className="mb-4 text-[13px] text-mut">
        <b>{customer?.company ?? '—'}</b> · due {fmtDate(installment.dueDate)} · {label(sale.paymentMode)}
      </p>

      <FormSection first>Outcome</FormSection>
      <div className="grid grid-cols-2 gap-x-4 gap-y-[14px]">
        <Field label="Status" span2 hint={chosen?.hint}>
          <Select value={status} onChange={(e) => setStatus(e.target.value as CollectionStatus)}>
            {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </Field>
        {status === 'collected' && (
          <Field
            label="Date collected"
            hint={
              preview === null ? undefined
                : preview > 0 ? `${preview} day${preview === 1 ? '' : 's'} past due - counts as late.`
                : 'On time.'
            }
          >
            <Input type="date" value={collectedOn} onChange={(e) => setCollectedOn(e.target.value)} />
          </Field>
        )}
        <Field
          label="Reference number"
          hint="Check number, or the deposit slip reference."
          span2={status !== 'collected'}
        >
          <Input value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} placeholder="e.g. BPI-DS-887214" />
        </Field>
      </div>

      <FormSection>Who &amp; where</FormSection>
      <div className="grid grid-cols-2 gap-x-4 gap-y-[14px]">
        <Field label="Person in charge">
          <Select value={collectorId} onChange={(e) => setCollectorId(e.target.value)}>
            <option value="">Unassigned</option>
            {personnel.filter((p) => p.active !== false).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Receiving bank account">
          <Select value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)}>
            <option value="">—</option>
            {bankAccounts.map((b) => (
              <option key={b.id} value={b.id}>{b.bankName} {b.accountNumberMasked}</option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="mt-2 rounded-[10px] border border-fill2 px-3 py-2 text-[13px]">
        <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-faint">Collect from</p>
        <p className="m-0">{collectAddress}</p>
        <p className="m-0 text-mut">{collectPerson} · {collectNumber}</p>
      </div>

      <FormSection>Notes</FormSection>
      <div className="grid grid-cols-2 gap-x-4 gap-y-[14px]">
        <Field
          label={status === 'collected' ? 'Notes' : 'Reason'}
          span2
          hint="Exhibit A asks for the reason behind every late or missed collection."
        >
          <Input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={status === 'bounced' ? 'e.g. Insufficient funds - client re-issuing' : 'e.g. Cheque signatory out of office until Friday'}
          />
        </Field>
      </div>

      <FormSection>Collection form</FormSection>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={printForm}
          disabled={busy}
          className="cursor-pointer rounded-[8px] border border-inputline bg-white px-3 py-[7px] text-[12px] font-semibold text-tealbtn hover:bg-fill2 disabled:opacity-50"
        >
          {busy ? 'Working…' : formNo ? 'Reprint form' : 'Print collection form'}
        </button>
        {formNo && <span className="text-[12px] text-faint">Form {formNo}</span>}
      </div>

      <div className="mt-3">
        <DocumentUpload tbl="sales" recordId={sale.id} slots={['depositSlip', 'checkImage', 'collectionForm']} />
      </div>
    </Dialog>
  )
}
