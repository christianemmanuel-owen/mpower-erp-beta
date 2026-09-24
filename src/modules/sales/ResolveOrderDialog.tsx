import { useEffect, useState } from 'react'
import { ChoiceCard, Choices, Field, GhostButton, Input, PrimaryButton, Step, Dialog } from '../../components/ui'
import { RailAside, RailClose, RailDelta, RailRow, RailSection } from '../../components/SummaryRail'
import { fmtCurrency, fmtLiters } from '../../lib/format'
import { defaultTreatment, planResolution, treatmentsFor } from '../../lib/orderResolution'
import { isPending } from '../../lib/approvals'
import { useAuth } from '../../lib/auth'
import { repos } from '../../data/repo'
import type { OrderTreatment, Sale } from '../../data/types'

/**
 * Cancelling or returning an order - Exhibit A 1.3.
 *
 * Three questions, asked as three choices rather than a form of controls:
 * why, what happens to the money, and (for a return) how much came back and
 * whether it went back into the tank. Each choice is a card, so the options
 * and what each one means are read side by side instead of one at a time
 * out of a dropdown.
 *
 * The consequences sit in the rail on the right and move as the choices do -
 * the receipt for what this write will do to sales, stock and what is owed,
 * read before the button is pressed, because this reverses an order.
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
  const [backToStock, setBackToStock] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!sale) return
    setReason('')
    setTreatment(defaultTreatment(kind))
    setPartial(false)
    setVolume(String(sale.volumeLiters))
    setBackToStock(true)
    setError(null)
  }, [sale, kind])

  if (!sale) return null

  const verb = kind === 'cancelled' ? 'Cancel' : 'Return'
  const options = treatmentsFor(kind)
  const orderValue = sale.volumeLiters * sale.pricePerLiter

  const returnedVolume = partial ? Number(volume) : undefined
  const volumeValid = !partial || (volume.trim() !== '' && Number.isFinite(returnedVolume) && (returnedVolume ?? 0) > 0 && (returnedVolume ?? 0) <= sale.volumeLiters)

  const plan = planResolution(sale, {
    kind,
    reason,
    treatment,
    volumeReturned: volumeValid ? returnedVolume : undefined,
    backToStock,
    date: new Date().toISOString(),
    recordedBy: seat?.id,
  })
  const offSales = plan.returnedVolume * sale.pricePerLiter

  async function save() {
    if (!sale) return
    if (!reason.trim()) {
      setError(`Give a reason - a ${kind === 'cancelled' ? 'cancellation' : 'return'} with no reason can’t be explained later.`)
      return
    }
    if (!volumeValid) {
      setError(`Enter how much is coming back, up to ${fmtLiters(sale.volumeLiters)}.`)
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
      subtitle={`${fmtLiters(sale.volumeLiters)} at ₱${sale.pricePerLiter.toFixed(2)}/L · ${fmtCurrency(orderValue)}${sale.clientPoReferenceNo ? ` · PO ${sale.clientPoReferenceNo}` : ''}`}
      onClose={onClose}
      width={860}
      rail={
        <>
          <RailSection title="What this does">
            <RailRow label="Order" value={fmtCurrency(orderValue)} />
            <RailDelta
              label={kind === 'returned' ? 'Off net sales' : 'Off sales'}
              sign="-"
              value={<>{fmtLiters(plan.returnedVolume)} · {fmtCurrency(offSales)}</>}
            />
            <RailClose label="Counts as sold" value={<>{fmtLiters(sale.volumeLiters - plan.returnedVolume)} · {fmtCurrency(orderValue - offSales)}</>} />
            <RailAside>
              {kind === 'returned'
                ? 'Net sales are sales less returns, whatever is done about the money. Volume sold and the agent’s quota move with it.'
                : 'The order stops counting towards sales, volume sold and the agent’s quota.'}
            </RailAside>
          </RailSection>

          <RailSection title="Stock">
            {plan.restockedVolume > 0 ? (
              <>
                <RailDelta label={`Back into ${sale.warehouseId ? 'the depot' : 'stock'}`} sign="+" value={fmtLiters(plan.restockedVolume)} />
                <RailAside>Available to sell again.</RailAside>
              </>
            ) : kind === 'returned' ? (
              <>
                <RailRow label="Back into the depot" value="Nothing" />
                <RailAside>The {fmtLiters(plan.returnedVolume)} is off sales but still out of the tank - it shows as a stock loss, not a sales one.</RailAside>
              </>
            ) : (
              <>
                <RailRow label="Movement" value="None" />
                <RailAside>The order never left the depot.</RailAside>
              </>
            )}
          </RailSection>

          <RailSection title="Money">
            <RailRow
              label="Installments cancelled"
              value={plan.cancelledInstallments > 0 ? `${plan.cancelledInstallments} pending` : 'None pending'}
            />
            {plan.collectedAmount > 0 && <RailRow label="Already collected" value={fmtCurrency(plan.collectedAmount)} />}
            <RailAside>
              {plan.collectedAmount > 0
                ? 'Collected money stays collected; returning it to the customer is a separate action, so record the intent here.'
                : 'Nothing further is owed.'}
            </RailAside>
          </RailSection>

          <RailAside>This can be undone. Reverting puts the order back where it was and makes cancelled installments payable again.</RailAside>
        </>
      }
      footer={
        <>
          <GhostButton onClick={onClose}>Never mind</GhostButton>
          <PrimaryButton onClick={save} disabled={saving}>{saving ? 'Saving…' : `${verb} order`}</PrimaryButton>
        </>
      }
    >
      {error && (
        <p className="mb-4 rounded-[8px] border border-redf bg-redbadge px-3 py-2 font-meta text-[12px] font-semibold text-redtext">{error}</p>
      )}

      <Step n={1} title="Reason">
        <Field label="Reason" hideLabel hint="Recorded against the order and shown in reporting.">
          <Input
            autoFocus
            value={reason}
            placeholder={kind === 'cancelled' ? 'e.g. Customer withdrew the order' : 'e.g. Fuel rejected on arrival - off-spec'}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
      </Step>

      <Step n={2} title="Payment treatment">
        <Choices>
          {options.map((o) => (
            <ChoiceCard key={o.value} on={treatment === o.value} onClick={() => setTreatment(o.value)} title={o.label} note={o.hint} />
          ))}
        </Choices>
      </Step>

      {/* Only returns can be partial - a cancellation is all-or-nothing by
          definition, since nothing left the warehouse. And only a return has
          fuel that may or may not come back: the two questions the client's
          accounting keeps apart. The return comes off sales either way;
          whether the litres re-enter the depot is the stock question. */}
      {kind === 'returned' && (
        <>
          <Step n={3} title="Return volume">
            <Choices>
              <ChoiceCard on={!partial} onClick={() => setPartial(false)} title="The whole order" note={fmtLiters(sale.volumeLiters)} />
              <ChoiceCard on={partial} onClick={() => setPartial(true)} title="Part of it" note="Enter the litres">
                {partial && (
                  <span className="mt-[8px] flex items-center gap-[6px]" onClick={(e) => e.stopPropagation()}>
                    <Input
                      type="number"
                      min={1}
                      max={sale.volumeLiters}
                      value={volume}
                      aria-label="Volume returned in litres"
                      autoFocus
                      onChange={(e) => setVolume(e.target.value)}
                      className="!w-[120px]"
                    />
                    <span className="font-meta text-[12px] text-mut">of {fmtLiters(sale.volumeLiters)}</span>
                  </span>
                )}
              </ChoiceCard>
            </Choices>
          </Step>

          <Step n={4} title="Fuel recovery" last>
            <Choices>
              <ChoiceCard on={backToStock} onClick={() => setBackToStock(true)} title="Back in the depot" note="Pumped back into the tank; can be sold again." />
              <ChoiceCard on={!backToStock} onClick={() => setBackToStock(false)} title="Not recovered" note="Off-spec, spilt or left with the customer - a stock loss." />
            </Choices>
          </Step>
        </>
      )}
    </Dialog>
  )
}
