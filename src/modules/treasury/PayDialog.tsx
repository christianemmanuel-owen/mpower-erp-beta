import { useEffect, useState } from 'react'
import {
  Field, FormSection, GhostButton, Input, PrimaryButton, Select, Textarea, Dialog,
} from '../../components/ui'
import { RailAside, RailClose, RailRow, RailSection } from '../../components/SummaryRail'
import DocumentUpload from '../../components/DocumentUpload'
import { fmtCurrency, fmtDate, label } from '../../lib/format'
import { useAuth } from '../../lib/auth'
import { useOpenRecord } from '../../lib/peek'
import { recordHref } from '../../lib/deepLink'
import type { BankAccount, PaymentMode, Purchase, PurchaseInstallment, Supplier } from '../../data/types'

/**
 * Paying a supplier.
 *
 * Mark paid was one click: the installment went to paid with today's date
 * and whatever account the filter happened to hold, and the check number -
 * the one thing the supplier will quote back when the payment is disputed -
 * was never asked for. The sales side asks for a slip number and an account
 * on every deposit; money going out gets the same receipt: when, how, from
 * where, under what number, and who released it.
 */
export type PayEntry = { purchase: Purchase; installment: PurchaseInstallment }

/** A fact on the receipt, in view mode. */
function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="m-0 font-meta text-[11px] font-semibold uppercase tracking-[.08em] text-mut">{label}</p>
      <p className="m-0 mt-[3px] text-[13px] font-semibold leading-[1.3]">{value ?? '—'}</p>
    </div>
  )
}

const MODES: PaymentMode[] = ['check', 'bank_transfer', 'cash']

export default function PayDialog({ entry, suppliers, bankAccounts, onClose, onSave }: {
  entry: PayEntry | null
  suppliers: Supplier[]
  bankAccounts: BankAccount[]
  onClose: () => void
  onSave: (purchaseId: string, installmentId: string, patch: Partial<PurchaseInstallment>) => Promise<void>
}) {
  const { seat } = useAuth()
  const openRecord = useOpenRecord()
  const [on, setOn] = useState('')
  const [mode, setMode] = useState<PaymentMode>('check')
  const [reference, setReference] = useState('')
  const [bankAccountId, setBankAccountId] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!entry) return
    const { purchase, installment } = entry
    setOn(new Date().toISOString().slice(0, 10))
    setMode(installment.paymentMode ?? purchase.paymentMode ?? 'check')
    setReference(installment.referenceNo ?? '')
    setBankAccountId(installment.bankAccountId ?? purchase.bankAccountId ?? '')
    setNotes(installment.notes ?? '')
    setError(null)
  }, [entry])

  if (!entry) return null
  const { purchase, installment } = entry
  const supplier = suppliers.find((s) => s.id === purchase.supplierId)
  // Already paid: the same receipt, read back. Nothing here is edited after
  // the fact - a wrong payment is reversed, not retyped.
  const viewing = installment.status === 'paid'
  const late = Date.parse(installment.dueDate) < Date.parse((viewing ? installment.paidAt : on) || new Date().toISOString())
  const purchaseHref = recordHref('purchases', purchase.id)
  const refLabel = mode === 'check' ? 'Check no.' : mode === 'bank_transfer' ? 'Transfer reference' : 'Voucher no.'

  async function save() {
    if (!entry) return
    if (!on) { setError('Record the date the money went out.'); return }
    if (mode === 'check' && !reference.trim()) { setError('Record the check number - it is what the supplier quotes back.'); return }
    if (mode !== 'cash' && !bankAccountId) { setError('Say which account it went out of.'); return }
    setBusy(true)
    setError(null)
    try {
      await onSave(purchase.id, installment.id, {
        status: 'paid',
        paidAt: new Date(on).toISOString(),
        paidBy: seat?.id,
        paidByName: seat?.name,
        paymentMode: mode,
        referenceNo: reference.trim() || undefined,
        bankAccountId: mode === 'cash' ? undefined : bankAccountId || undefined,
        notes: notes.trim() || undefined,
      })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t record this payment.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      title={viewing ? 'Payment' : 'Pay supplier'}
      subtitle={`${supplier?.name ?? '—'} · ${fmtCurrency(installment.amount)}${purchase.poReferenceNo ? ` · PO ${purchase.poReferenceNo}` : ''}`}
      onClose={onClose}
      width={820}
      rail={
        <RailSection title="What's owed">
          <RailRow label="Amount" value={fmtCurrency(installment.amount)} />
          <RailRow label="Due" value={<span className={late ? 'font-semibold text-redtext' : undefined}>{fmtDate(installment.dueDate)}{late ? ' · late' : ''}</span>} />
          <RailRow label="Agreed as" value={label(purchase.paymentMode)} />
          {purchase.poReferenceNo && <RailRow label="PO" value={purchase.poReferenceNo} />}
          <RailRow label="Ordered" value={fmtDate(purchase.date)} />
          {viewing ? (
            <RailClose label="Status" value="Paid" />
          ) : (
            <>
              <RailClose label="On save" value="Paid" />
              <RailAside>
                Comes off what we owe {supplier?.name ?? 'the supplier'} on the date paid. Released by {seat?.name ?? 'you'}.
              </RailAside>
            </>
          )}
        </RailSection>
      }
      footer={viewing ? (
        <>
          {purchaseHref && <GhostButton onClick={() => { onClose(); openRecord(purchaseHref) }}>Open purchase</GhostButton>}
          <PrimaryButton onClick={onClose}>Done</PrimaryButton>
        </>
      ) : (
        <>
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Record payment'}</PrimaryButton>
        </>
      )}
    >
      {viewing ? (
        <>
          <FormSection first>The payment</FormSection>
          <div className="grid grid-cols-2 gap-x-4 gap-y-[14px]">
            <Fact label="Date paid" value={installment.paidAt ? fmtDate(installment.paidAt) : '—'} />
            <Fact label="How" value={label(installment.paymentMode ?? purchase.paymentMode)} />
            <Fact label={(installment.paymentMode ?? purchase.paymentMode) === 'check' ? 'Check no.' : 'Reference'} value={installment.referenceNo} />
            <Fact label="From account" value={(() => { const b = bankAccounts.find((x) => x.id === installment.bankAccountId); return b ? `${b.bankName} ${b.accountNumberMasked}` : (installment.paymentMode === 'cash' ? 'Cash' : '—') })()} />
            <Fact label="Released by" value={installment.paidByName} />
            {installment.notes && <div className="col-span-2"><Fact label="Notes" value={<span className="font-normal text-lab">{installment.notes}</span>} /></div>}
          </div>
          <FormSection>Paper</FormSection>
          <DocumentUpload tbl="purchases" recordId={purchase.id} slots={['paymentProof', 'supplierInvoice']} />
        </>
      ) : (
        <>
      {error && (
        <p className="mb-4 rounded-[8px] border border-redf bg-redbadge px-3 py-2 font-meta text-[12px] font-semibold text-redtext">{error}</p>
      )}
      <FormSection first>The payment</FormSection>
      <div className="grid grid-cols-2 gap-x-4 gap-y-[14px]">
        <Field label="Date paid">
          <Input type="date" value={on} onChange={(e) => setOn(e.target.value)} />
        </Field>
        <Field label="How">
          <Select value={mode} onChange={(e) => setMode(e.target.value as PaymentMode)}>
            {MODES.map((m) => <option key={m} value={m}>{label(m)}</option>)}
          </Select>
        </Field>
        <Field label={refLabel} optional={mode !== 'check'} hint={mode === 'check' ? 'As printed on the check.' : 'As the bank shows it.'}>
          <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder={mode === 'check' ? 'e.g. 0012345' : 'e.g. FT26092400123'} />
        </Field>
        {mode !== 'cash' && (
          <Field label="From account" hint="Which of our accounts it left.">
            <Select value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)}>
              <option value="">—</option>
              {bankAccounts.map((b) => <option key={b.id} value={b.id}>{b.bankName} {b.accountNumberMasked}</option>)}
            </Select>
          </Field>
        )}
      </div>
      <FormSection>Notes and paper</FormSection>
      <Field label="Notes" optional hint="Why it was paid late, a partial, anything the auditor will ask.">
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      </Field>
      <div className="mt-[10px]">
        <DocumentUpload tbl="purchases" recordId={purchase.id} slots={['paymentProof']} />
      </div>
        </>
      )}
    </Dialog>
  )
}
