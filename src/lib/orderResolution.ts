import type { OrderTreatment, Sale, SaleStatus } from '../data/types'

/**
 * Cancelling and returning orders - Exhibit A 1.3, "cancelled orders, with
 * reason and treatment" and "returned orders, with reason and treatment".
 *
 * The spec asks for two things the System has to keep straight. A cancellation
 * kills an order before the fuel moves; a return sends fuel back after it moved.
 * They read similarly on a form and behave completely differently underneath:
 *
 *   - A **cancelled** order never consumed stock, so there is nothing to put
 *     back. Its installments should stop being collectable.
 *   - A **returned** order did consume stock. Whether any of it comes back
 *     depends on the treatment: fuel restocked to the warehouse returns to
 *     inventory, fuel written off does not. That distinction is what
 *     `restockedVolume()` in metrics.ts reads, and it is why treatment is a
 *     field rather than a note.
 *
 * The money side is deliberately conservative. Cancelling or returning an order
 * cancels its **pending** installments - nothing is owed on an order that was
 * called off. Installments already marked collected are left alone: the money
 * arrived, and whether it goes back to the customer is what `treatment` records
 * (refunded / credit note / replaced), not something the System should silently
 * reverse. A refund the System invented would be a payment nobody authorised.
 */

export const TREATMENT_OPTIONS: ReadonlyArray<{
  value: OrderTreatment
  label: string
  hint: string
  /** Whether this treatment makes sense for a cancellation, a return, or both. */
  appliesTo: 'cancelled' | 'returned' | 'both'
}> = [
  { value: 'restocked', label: 'Restocked', hint: 'Fuel came back into the warehouse and is available to sell again.', appliesTo: 'returned' },
  { value: 'refunded', label: 'Refunded', hint: 'Money already collected is being returned to the customer.', appliesTo: 'both' },
  { value: 'credit_note', label: 'Credit note', hint: 'Held as credit against the customer’s future orders.', appliesTo: 'both' },
  { value: 'replaced', label: 'Replaced', hint: 'Re-delivered instead of refunded - raise the replacement as its own order.', appliesTo: 'returned' },
  { value: 'written_off', label: 'Written off', hint: 'Absorbed as a loss. Nothing returns to stock and nothing is recovered.', appliesTo: 'both' },
  { value: 'no_action', label: 'No action', hint: 'Nothing owed, nothing returned - the order simply did not happen.', appliesTo: 'cancelled' },
]

export const treatmentsFor = (kind: 'cancelled' | 'returned') =>
  TREATMENT_OPTIONS.filter((t) => t.appliesTo === kind || t.appliesTo === 'both')

/** The default treatment for each kind - the overwhelmingly common case. */
export const defaultTreatment = (kind: 'cancelled' | 'returned'): OrderTreatment =>
  kind === 'cancelled' ? 'no_action' : 'restocked'

export interface ResolveInput {
  kind: 'cancelled' | 'returned'
  reason: string
  treatment: OrderTreatment
  /** Only meaningful for a return; blank means the whole order came back. */
  volumeReturned?: number
  date: string
  recordedBy?: string
}

export interface ResolvePlan {
  patch: Partial<Sale>
  /** Pending installments that will be cancelled by this resolution. */
  cancelledInstallments: number
  /** Value of installments already collected, which this does NOT reverse. */
  collectedAmount: number
  /** Litres that will return to stock, given the treatment. */
  restockedVolume: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Works out the whole write for a cancellation or return. Pure - the caller
 * decides whether to send it.
 */
export function planResolution(sale: Sale, input: ResolveInput): ResolvePlan {
  const collected = sale.installments.filter((i) => i.status === 'collected')
  const collectedAmount = round2(collected.reduce((s, i) => s + i.amount, 0))

  // Pending becomes cancelled; collected and already-cancelled rows are left as
  // they are. Nothing is owed on an order that was called off, but money that
  // has already arrived is not un-collected by a status change.
  const installments = sale.installments.map((i) =>
    i.status === 'pending' ? { ...i, status: 'cancelled' as const } : i,
  )
  const cancelledInstallments = sale.installments.filter((i) => i.status === 'pending').length

  const volumeReturned =
    input.kind === 'returned' && input.volumeReturned !== undefined && input.volumeReturned > 0
      ? Math.min(input.volumeReturned, sale.volumeLiters)
      : undefined

  // Mirrors restockedVolume() in metrics.ts: only a return treated as restocked
  // puts fuel back. Keeping the rule in one shape in both places is deliberate -
  // if they disagree, stock on hand and this preview disagree too.
  const restocked =
    input.kind === 'returned' && input.treatment === 'restocked'
      ? volumeReturned ?? sale.volumeLiters
      : 0

  return {
    patch: {
      status: input.kind,
      installments,
      resolution: {
        date: input.date,
        reason: input.reason.trim(),
        treatment: input.treatment,
        ...(volumeReturned !== undefined ? { volumeReturned } : {}),
        // Recorded so Revert can put the order back where it was rather than
        // guessing. See OrderResolution.previousStatus.
        previousStatus: sale.status,
        ...(input.recordedBy ? { recordedBy: input.recordedBy } : {}),
      },
    },
    cancelledInstallments,
    collectedAmount,
    restockedVolume: restocked,
  }
}

/**
 * Undoing a resolution. The order goes back to the status it held before, and
 * the installments this resolution cancelled become payable again.
 *
 * The honest limitation: installments cancelled by the user *before* the order
 * was resolved are indistinguishable from ones the resolution cancelled, so
 * reverting restores all cancelled rows to pending. That is the safer direction
 * to be wrong in - an installment wrongly made payable is visible in the
 * collection queue and can be cancelled again, whereas one wrongly left
 * cancelled is money quietly never chased.
 */
export function planRevertResolution(sale: Sale): Partial<Sale> {
  const previous: SaleStatus = sale.resolution?.previousStatus ?? 'confirmed'
  return {
    status: previous,
    installments: sale.installments.map((i) =>
      i.status === 'cancelled' ? { ...i, status: 'pending' as const } : i,
    ),
    resolution: undefined,
  }
}
