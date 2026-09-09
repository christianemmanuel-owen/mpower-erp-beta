import { useEffect, useState } from 'react'
import { Field, GhostButton, Input, PrimaryButton, SectionLabel, Dialog } from '../../components/ui'
import DocumentUpload from '../../components/DocumentUpload'
import { fmtCurrency, fmtLiters } from '../../lib/format'
import { planReceiptAdjustment } from '../../lib/receiving'
import { isPending } from '../../lib/approvals'
import { repos } from '../../data/repo'
import type { Purchase } from '../../data/types'

/**
 * Receiving a delivery - Exhibit A 1.2, "volume received per transaction".
 *
 * Marking a purchase received used to be a one-click status flip, which quietly
 * assumed every delivery arrives exactly as ordered. Fuel deliveries routinely
 * don't: tankers run short, meters disagree, and the difference is the whole
 * reason the spec asks for received volume separately from ordered volume.
 *
 * So the flip now asks. The field is pre-filled with the ordered volume, so the
 * common case is still one extra keystroke - Enter - but a short or over
 * delivery is recordable instead of being silently rounded to the order.
 *
 * Stock on hand counts the received figure (`receivedVolume()` in
 * src/lib/metrics.ts), so this is also the number the low supply warning (2.3)
 * is evaluated against.
 *
 * Per Q13, what MPower owes follows the delivered volume too, so receiving also
 * re-spreads the unpaid installments (`planReceiptAdjustment()` in
 * src/lib/receiving.ts). That rewrites money, so it is shown before it happens
 * and can be declined - the Client answered "assume yes", not "certainly yes".
 */
export default function ReceiveDialog({ purchase, onClose, onNotice }: {
  purchase: Purchase | null
  onClose: () => void
  onNotice: (message: string) => void
}) {
  const [volume, setVolume] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  /** Q13 default - on, but the user can decline for a disputed delivery. */
  const [adjustPlan, setAdjustPlan] = useState(true)

  useEffect(() => {
    if (!purchase) return
    setVolume(String(purchase.volumeReceived ?? purchase.volumeLiters))
    setError(null)
    setAdjustPlan(true)
  }, [purchase])

  if (!purchase) return null

  const received = Number(volume)
  // An empty field must not be treated as zero. Number('') is 0, which is finite
  // and non-negative, so a naive check would happily record "nothing arrived"
  // for someone who simply cleared the box - and stock on hand would drop by the
  // whole order with no warning. A deliberate 0 (the tanker turned up empty) is
  // still allowed; a blank one is not.
  const valid = volume.trim() !== '' && Number.isFinite(received) && received >= 0
  const variance = valid ? received - purchase.volumeLiters : 0
  const variancePct = purchase.volumeLiters > 0 ? (variance / purchase.volumeLiters) * 100 : 0

  const adjustment = valid ? planReceiptAdjustment(purchase, received) : null
  const showAdjustment = !!adjustment && variance !== 0

  async function save() {
    if (!purchase || !valid) {
      setError('Enter the volume that actually arrived.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const result = await repos.purchases.update(purchase.id, {
        status: 'received',
        volumeReceived: received,
        // The interval a load belongs to is the one it landed in, not the one
        // it was ordered in. Without this, a tanker ordered on the 28th and
        // received on the 3rd counts against the wrong month everywhere.
        receivedAt: new Date().toISOString(),
        // Only send installments when the plan actually moves - an unchanged
        // array would still bump updatedAt and, under approvals, park a
        // no-op edit for someone to review.
        ...(adjustPlan && adjustment?.changed ? { installments: adjustment.installments } : {}),
      })
      // The status flip is a write like any other, so it can be parked for
      // approval too (Secondary Feature 2.1).
      if (isPending(result)) onNotice(result.message)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t record this delivery.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open
      title="Receive delivery"
      onClose={onClose}
      width={560}
      footer={
        <>
          <div className="flex-1">
            <SectionLabel>Variance</SectionLabel>
            <p className={`tnum m-0 mt-[2px] text-[20px] font-semibold ${variance === 0 ? '' : variance < 0 ? 'text-red-600' : 'text-teal-700'}`}>
              {!valid || variance === 0
                ? 'None'
                : `${variance > 0 ? '+' : ''}${fmtLiters(variance)} (${variancePct > 0 ? '+' : ''}${variancePct.toFixed(1)}%)`}
            </p>
          </div>
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton onClick={save}>{saving ? 'Saving…' : 'Mark received'}</PrimaryButton>
        </>
      }
    >
      {error && (
        <p className="mb-3 rounded-[6px] border border-redf bg-redbadge px-3 py-2 text-[13px] font-semibold text-redtext">{error}</p>
      )}

      <p className="mb-4 text-[13px] text-mut">
        Ordered <b>{fmtLiters(purchase.volumeLiters)}</b>
        {purchase.poReferenceNo ? <> on PO <b>{purchase.poReferenceNo}</b></> : null}. Record what actually
        arrived - stock on hand counts this figure, not the order.
      </p>

      <div className="grid grid-cols-2 gap-x-4 gap-y-[14px]">
        <Field
          label="Volume received (L)"
          span2
          hint={
            valid && variance !== 0
              ? variance < 0
                ? `${fmtLiters(Math.abs(variance))} short of the order.`
                : `${fmtLiters(variance)} more than ordered.`
              : 'Leave as-is if the full order arrived.'
          }
        >
          <Input
            autoFocus
            type="number"
            min={0}
            value={volume}
            onChange={(e) => setVolume(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') save() }}
          />
        </Field>
      </div>

      {/* Q13 - payable follows the delivered volume. Shown before it happens,
          because it rewrites what MPower owes. */}
      {showAdjustment && adjustment && (
        <div className="mt-4 rounded-[10px] border border-inputline bg-fill2 px-3 py-3">
          <SectionLabel>Payment plan</SectionLabel>
          <div className="mt-2 grid grid-cols-2 gap-y-[6px] text-[13px]">
            <span className="text-mut">Ordered</span>
            <span className="tnum text-right">{fmtCurrency(adjustment.orderedTotal)}</span>
            <span className="text-mut">Delivered</span>
            <span className="tnum text-right font-semibold">{fmtCurrency(adjustment.receivedTotal)}</span>
            {adjustment.paidTotal > 0 && (
              <>
                <span className="text-mut">Already paid</span>
                <span className="tnum text-right">−{fmtCurrency(adjustment.paidTotal)}</span>
              </>
            )}
            <span className="border-t border-inputline pt-[6px] text-mut">Still to pay</span>
            <span className="tnum border-t border-inputline pt-[6px] text-right font-semibold">
              {fmtCurrency(adjustment.remainingPayable)}
            </span>
          </div>

          {adjustment.adjustable ? (
            <label className="mt-3 flex cursor-pointer items-start gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={adjustPlan}
                onChange={(e) => setAdjustPlan(e.target.checked)}
                className="mt-[3px] cursor-pointer"
              />
              <span>
                Adjust the unpaid installments to match
                <span className="block text-[12px] text-faint">
                  Spread across the pending rows in their current proportions. Paid installments are left alone.
                  Untick if this shortfall is disputed and the original terms still stand.
                </span>
              </span>
            </label>
          ) : (
            <p className="mt-3 mb-0 text-[12px] text-faint">
              Nothing left to adjust - this plan is already settled or cancelled. Settle the difference with the
              supplier directly.
            </p>
          )}

          {adjustment.overpaid > 0 && (
            <p className="mt-2 mb-0 rounded-[8px] bg-amber-50 px-2 py-[6px] text-[12px] text-amber-800">
              <b>{fmtCurrency(adjustment.overpaid)}</b> more has been paid than this delivery is worth. The System
              won’t create a refund - recover it from the supplier or offset it against the next purchase.
            </p>
          )}
        </div>
      )}

      <div className="mt-4">
        <SectionLabel>Delivery documents</SectionLabel>
        <p className="mb-2 text-[12px] text-faint">
          Attach the supplier’s delivery receipt and, where the load was tested, the fuel analysis slip.
        </p>
        <DocumentUpload
          tbl="purchases"
          recordId={purchase.id}
          slots={['supplierDeliveryReceipt', 'fuelAnalysisSlip']}
        />
      </div>
    </Dialog>
  )
}
