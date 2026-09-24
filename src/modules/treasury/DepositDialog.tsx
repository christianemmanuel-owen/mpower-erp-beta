import { useEffect, useState } from 'react'
import {
  ChoiceCard, Choices, Field, GhostButton, Input, PrimaryButton, Select, Step, Dialog,
} from '../../components/ui'
import { RailAside, RailClose, RailRow, RailSection } from '../../components/SummaryRail'
import DocumentUpload from '../../components/DocumentUpload'
import PaymentPath from '../../components/PaymentPath'
import { fmtCurrency, fmtDate, label } from '../../lib/format'
import { depositOverdue } from '../../lib/metrics'
import { useAuth } from '../../lib/auth'
import type { BankAccount, Customer, Sale, SaleInstallment } from '../../data/types'

/**
 * Banking what a collector brought in, and hearing back from the bank.
 *
 * Two jobs, one dialog, because they are the same conversation at different
 * moments: a slip number and an account on the way out, a yes or a no on the
 * way back. Both belong to Treasury and neither belongs to the person who
 * took the money off the customer - see installmentWriteProblem in
 * server/access.ts, which is where that is actually enforced.
 *
 * Nothing here can change how the payment was collected. The collection date,
 * the check number and the collector are shown because the cashier needs to
 * know what they are holding, and they are shown as facts rather than fields.
 */
export default function DepositDialog({
  entry, stage, customers, bankAccounts, onClose, onSave,
}: {
  entry: { sale: Sale; installment: SaleInstallment } | null
  /** `deposit` banks it; `clear` records what the bank said. */
  stage: 'deposit' | 'clear'
  customers: Customer[]
  bankAccounts: BankAccount[]
  onClose: () => void
  onSave: (saleId: string, installmentId: string, patch: Partial<SaleInstallment>) => Promise<void>
}) {
  // Whose hands it passed through at the bank end. The field exists so the
  // deposit and the collection are attributable to two different people.
  const { seat } = useAuth()
  const [outcome, setOutcome] = useState<'cleared' | 'bounced'>('cleared')
  const [on, setOn] = useState('')
  const [slipNo, setSlipNo] = useState('')
  const [bankAccountId, setBankAccountId] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!entry) return
    const { sale, installment } = entry
    setOutcome('cleared')
    setOn(new Date().toISOString().slice(0, 10))
    setSlipNo(installment.depositSlipNo ?? '')
    setBankAccountId(installment.bankAccountId ?? sale.bankAccountId ?? '')
    setNotes('')
    setError(null)
  }, [entry])

  if (!entry) return null
  const { sale, installment } = entry
  const customer = customers.find((c) => c.id === sale.customerId)
  const depositing = stage === 'deposit'

  // A post-dated check cannot be banked before the date on its face, however
  // long it has been sitting in the drawer. Saying so here saves a trip.
  const bankableFrom = installment.checkDate
  const notYetBankable = !!bankableFrom && !depositOverdue(bankableFrom)

  async function save() {
    if (!entry) return
    if (!on) {
      setError(depositing ? 'Record the date it was banked.' : 'Record the date the bank settled it.')
      return
    }
    if (!depositing && outcome === 'bounced' && !notes.trim()) {
      setError('Say why the bank refused it - that reason is the account’s credit history.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const at = new Date(on).toISOString()
      await onSave(sale.id, installment.id, depositing
        ? {
          // Cash is money the moment it is in the account: banking it is the
          // end of the story. Only an instrument has a clearing to wait on.
          status: sale.paymentMode === 'cash' ? 'cleared' : 'deposited',
          depositedAt: at,
          depositedBy: seat?.id,
          ...(sale.paymentMode === 'cash' ? { clearedAt: at, clearedBy: seat?.id } : {}),
          depositSlipNo: slipNo.trim() || undefined,
          bankAccountId: bankAccountId || undefined,
        }
        : outcome === 'cleared'
          ? { status: 'cleared', clearedAt: at, clearedBy: seat?.id }
          // A bounce keeps the deposit record: it was banked, and refused. The
          // receivable was never taken off the balance, so nothing reverses.
          : { status: 'bounced', notes: notes.trim() })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t save this.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      title={depositing ? 'Deposit' : 'Clearing'}
      subtitle={`${customer?.company ?? '—'} · ${fmtCurrency(installment.amount)} · ${label(sale.paymentMode)}`}
      onClose={onClose}
      width={820}
      rail={
        <>
          <RailSection title="What you're holding">
            <RailRow label="Amount" value={fmtCurrency(installment.amount)} />
            {installment.referenceNo && <RailRow label="Check no." value={installment.referenceNo} />}
            {installment.checkDate && <RailRow label="Dated" value={fmtDate(installment.checkDate)} />}
            <RailRow label="Collected" value={installment.collectedAt ? fmtDate(installment.collectedAt) : '—'} />
            {!depositing && (
              <RailRow label="Deposited" value={installment.depositedAt ? fmtDate(installment.depositedAt) : '—'} />
            )}
            <RailClose
              label="On save"
              tone={!depositing && outcome === 'bounced' ? 'bad' : 'plain'}
              value={depositing ? (sale.paymentMode === 'cash' ? 'Cleared' : 'In clearing') : outcome === 'cleared' ? 'Cleared' : 'Bounced'}
            />
            {depositing && notYetBankable && (
              <RailRow label="Bankable" value={<span className="font-semibold text-redtext">from {fmtDate(bankableFrom!)}</span>} />
            )}
            <PaymentPath
              status={depositing
                ? (sale.paymentMode === 'cash' ? 'cleared' : 'deposited')
                : outcome === 'cleared' ? 'cleared' : 'bounced'}
              paymentMode={sale.paymentMode}
              depositedAt={installment.depositedAt ?? (depositing ? undefined : on)}
              size="sm"
              bracket={false}
              className="mt-[12px]"
            />
            <RailAside>
              {depositing
                ? sale.paymentMode === 'cash'
                  ? 'Cash has nothing to clear: this settles the receivable.'
                  : 'Stays on the customer’s balance until the bank clears it.'
                : outcome === 'cleared'
                  ? 'Settles the receivable, in the period it cleared.'
                  : 'The receivable stands; nothing to reverse.'}
            </RailAside>
          </RailSection>
        </>
      }
      footer={
        <>
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton onClick={save} disabled={busy}>
            {busy ? 'Saving…' : depositing ? 'Record deposit' : 'Save'}
          </PrimaryButton>
        </>
      }
    >
      {error && (
        <p className="mb-4 rounded-[8px] border border-redf bg-redbadge px-3 py-2 font-meta text-[12px] font-semibold text-redtext">{error}</p>
      )}

      {depositing ? (
        <>
          <Step n={1} title="The deposit">
            <div className="grid grid-cols-2 gap-x-4 gap-y-[14px]">
              <Field label="Date banked">
                <Input type="date" value={on} onChange={(e) => setOn(e.target.value)} />
              </Field>
              <Field label="Deposit slip no." optional hint="As printed on the slip.">
                <Input value={slipNo} onChange={(e) => setSlipNo(e.target.value)} placeholder="e.g. DS-204513" />
              </Field>
            </div>
          </Step>
          <Step n={2} title="Account" last>
            <Field label="Deposited into" hideLabel hint="Which of our accounts the money went into.">
              <Select value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)}>
                <option value="">—</option>
                {bankAccounts.map((b) => (
                  <option key={b.id} value={b.id}>{b.bankName} {b.accountNumberMasked}</option>
                ))}
              </Select>
            </Field>
            <div className="mt-[10px]">
              <DocumentUpload tbl="sales" recordId={sale.id} slots={['depositSlip', 'checkImage']} />
            </div>
          </Step>
        </>
      ) : (
        <>
          <Step n={1} title="What the bank did">
            <Choices>
              <ChoiceCard
                on={outcome === 'cleared'}
                onClick={() => setOutcome('cleared')}
                title="Cleared"
                note="Funds are available."
              />
              <ChoiceCard
                on={outcome === 'bounced'}
                onClick={() => setOutcome('bounced')}
                title="Bounced"
                note="Presented and refused."
                tone="bad"
              />
            </Choices>
          </Step>
          <Step n={2} title={outcome === 'cleared' ? 'Date' : 'Date and reason'} last>
            <div className="grid grid-cols-2 gap-x-4 gap-y-[14px]">
              <Field label={outcome === 'cleared' ? 'Date cleared' : 'Date refused'}>
                <Input type="date" value={on} onChange={(e) => setOn(e.target.value)} />
              </Field>
            </div>
            {outcome === 'bounced' && (
              <div className="mt-[14px]">
                <Field label="Reason" hideLabel hint="What the bank gave as the reason for refusing it.">
                  <Input
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="e.g. Drawn against uncollected deposits"
                  />
                </Field>
              </div>
            )}
          </Step>
        </>
      )}
    </Dialog>
  )
}
