import { useEffect, useState } from 'react'
import { Field, GhostButton, Input, PrimaryButton, SectionLabel, Select, Dialog } from '../../components/ui'
import { fmtCurrency, fmtLiters } from '../../lib/format'
import { defaultTreatment, planResolution, treatmentsFor } from '../../lib/orderResolution'
import { isPending } from '../../lib/approvals'
import { useAuth } from '../../lib/auth'
import { repos } from '../../data/repo'
import type { OrderTreatment, Sale } from '../../data/types'

/**
 * Cancelling or returning an order - Exhibit A 1.3.
 *
 * Reason and treatment are both required by the spec, and both are required
 * here: a cancellation with no reason is exactly the record nobody can explain
 * three months later, and treatment is what decides whether fuel goes back into
 * stock. The consequences are shown before the write, because this reverses an
 * order and cancels what is owed on it.
 *
 * The rules live in src/lib/orderResolution.ts; this is the form around them.
 */
export default function ResolveOrderDialog({ sale, kind, onClose, onNotice }: {
  sale: Sale | null
  kind: 'cancelled' | 'returned'
  onClose: () => void
  onNotice: (message: string) => void
}) {
  const { seat } = useAuth()
  const [reason, setReason] = useState('')
  const [treatment, setTreatment] = useState<OrderTreatment>(defaultTreatment(kind))
  const [partial, setPartial] = useState(false)
  const [volume, setVolume] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!sale) return
    setReason('')
    setTreatment(defaultTreatment(kind))
    setPartial(false)
    setVolume(String(sale.volumeLiters))
    setError(null)
  }, [sale, kind])

  if (!sale) return null

  const verb = kind === 'cancelled' ? 'Cancel' : 'Return'
  const options = treatmentsFor(kind)
  const chosen = options.find((o) => o.value === treatment)

  const returnedVolume = partial ? Number(volume) : undefined
  const volumeValid = !partial || (volume.trim() !== '' && Number.isFinite(returnedVolume) && (returnedVolume ?? 0) > 0)

  const plan = planResolution(sale, {
    kind,
    reason,
    treatment,
    volumeReturned: volumeValid ? returnedVolume : undefined,
    date: new Date().toISOString(),
    recordedBy: seat?.id,
  })

  async function save() {
    if (!sale) return
    if (!reason.trim()) {
      setError(`Give a reason - a ${kind === 'cancelled' ? 'cancellation' : 'return'} with no reason can’t be explained later.`)
      return
    }
    if (!volumeValid) {
      setError('Enter how much fuel came back, or untick the partial return.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const result = await repos.sales.update(sale.id, plan.patch)
      if (isPending(result)) onNotice(result.message)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : `Couldn’t ${verb.toLowerCase()} this order.`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open
      title={`${verb} order`}
      onClose={onClose}
      width={560}
      footer={
        <>
          <div className="flex-1">
            <SectionLabel>Order value</SectionLabel>
            <p className="tnum m-0 mt-[2px] text-[20px] font-semibold">
              {fmtCurrency(sale.volumeLiters * sale.pricePerLiter)}
            </p>
          </div>
          <GhostButton onClick={onClose}>Never mind</GhostButton>
          <PrimaryButton onClick={save}>{saving ? 'Saving…' : `${verb} order`}</PrimaryButton>
        </>
      }
    >
      {error && (
        <p className="mb-3 rounded-[6px] border border-redf bg-redbadge px-3 py-2 text-[13px] font-semibold text-redtext">{error}</p>
      )}

      <p className="mb-4 text-[13px] text-mut">
        {fmtLiters(sale.volumeLiters)} at ₱{sale.pricePerLiter.toFixed(2)}/L
        {sale.clientPoReferenceNo ? <>, against client PO <b>{sale.clientPoReferenceNo}</b></> : null}.
      </p>

      <FormRow>
        <Field label="Reason" span2 hint="Recorded against the order and shown in reporting.">
          <Input
            autoFocus
            value={reason}
            placeholder={kind === 'cancelled' ? 'e.g. Customer withdrew the order' : 'e.g. Fuel rejected on arrival - off-spec'}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        <Field label="Treatment" span2 hint={chosen?.hint}>
          <Select value={treatment} onChange={(e) => setTreatment(e.target.value as OrderTreatment)}>
            {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </Field>
      </FormRow>

      {/* Only returns can be partial - a cancellation is all-or-nothing by
          definition, since nothing left the warehouse. */}
      {kind === 'returned' && (
        <div className="mt-3">
          <label className="flex cursor-pointer items-center gap-2 text-[13px]">
            <input type="checkbox" checked={partial} onChange={(e) => setPartial(e.target.checked)} className="cursor-pointer" />
            Only part of the order came back
          </label>
          {partial && (
            <div className="mt-2 grid grid-cols-2 gap-3">
              <Field label="Volume returned (L)">
                <Input
                  type="number"
                  min={1}
                  max={sale.volumeLiters}
                  value={volume}
                  onChange={(e) => setVolume(e.target.value)}
                />
              </Field>
            </div>
          )}
        </div>
      )}

      <div className="mt-4 rounded-[10px] border border-inputline bg-fill2 px-3 py-3">
        <SectionLabel>What this does</SectionLabel>
        <ul className="mt-2 mb-0 list-disc pl-4 text-[13px] leading-[1.7]">
          <li>
            The order stops counting towards sales, volume out and agent quota.
          </li>
          <li>
            {plan.restockedVolume > 0
              ? <><b>{fmtLiters(plan.restockedVolume)}</b> returns to {sale.warehouseId ? 'the depot' : 'stock'} and is available to sell again.</>
              : kind === 'returned'
                ? 'No fuel returns to stock under this treatment.'
                : 'No stock movement - the order never left the depot.'}
          </li>
          <li>
            {plan.cancelledInstallments > 0
              ? <><b>{plan.cancelledInstallments}</b> pending {plan.cancelledInstallments === 1 ? 'installment is' : 'installments are'} cancelled - nothing further is owed.</>
              : 'There are no pending installments to cancel.'}
          </li>
          {plan.collectedAmount > 0 && (
            <li>
              <b>{fmtCurrency(plan.collectedAmount)}</b> already collected is left as collected. Returning it to
              the customer is a separate action - record it here as <i>refunded</i> or <i>credit note</i> so the
              intent is on file.
            </li>
          )}
        </ul>
      </div>

      <p className="mt-3 mb-0 text-[12px] text-faint">
        This can be undone - reverting puts the order back where it was and makes the cancelled installments
        payable again.
      </p>
    </Dialog>
  )
}

/** Local two-column row; the shared FormSection would add a heading we don't want here. */
function FormRow({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-4 gap-y-[14px]">{children}</div>
}
