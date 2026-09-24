import { wasCollected } from './collectionStatus'
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
 *   - A **returned** order did consume stock, and comes off net sales in full
 *     (or by the partial volume) - net sales are sales less returns, whatever
 *     was done about the money. Whether the litres come back into the tank is
 *     a separate fact, `backToStock`, which is all that `restockedVolume()` in
 *     metrics.ts reads. Inventory is not sales.
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
  { value: 'no_action', label: 'Nothing collected', hint: 'Nothing was paid yet - what was owed is simply cancelled.', appliesTo: 'both' },
  { value: 'refunded', label: 'Refunded', hint: 'Money already collected is being returned to the customer.', appliesTo: 'both' },
  { value: 'credit_note', label: 'Credit note', hint: 'Held as credit against the customer’s future orders.', appliesTo: 'both' },
  { value: 'replaced', label: 'Replaced', hint: 'Re-delivered under a new order - raise the replacement as its own sale.', appliesTo: 'returned' },
]

/** Labels for every value that can be stored, including the two legacy ones. */
export const TREATMENT_LABELS: Record<OrderTreatment, string> = {
  no_action: 'Nothing collected',
  refunded: 'Refunded',
  credit_note: 'Credit note',
  replaced: 'Replaced',
  restocked: 'Restocked',
  written_off: 'Written off',
}

export const treatmentsFor = (kind: 'cancelled' | 'returned') =>
  TREATMENT_OPTIONS.filter((t) => t.appliesTo === kind || t.appliesTo === 'both')

/** The default treatment for each kind - the overwhelmingly common case: the
 * order is reversed before any money has moved. */
export const defaultTreatment = (_kind: 'cancelled' | 'returned'): OrderTreatment => 'no_action'

export interface ResolveInput {
  kind: 'cancelled' | 'returned'
  reason: string
  treatment: OrderTreatment
  /** Only meaningful for a return; blank means the whole order was returned. */
  volumeReturned?: number
  /** Only meaningful for a return: the fuel came back into the depot, sellable. */
  backToStock?: boolean
  date: string
  recordedBy?: string
}

export interface ResolvePlan {
  patch: Partial<Sale>
  /** Pending installments that will be cancelled by this resolution. */
  cancelledInstallments: number
  /** Value of installments already collected, which this does NOT reverse. */
  collectedAmount: number
  /** Litres that come off net sales - the whole order, or the partial volume. */
  returnedVolume: number
  /** Litres that will return to stock - only when the fuel came back. */
  restockedVolume: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Works out the whole write for a cancellation or return. Pure - the caller
 * decides whether to send it.
 */
export function planResolution(sale: Sale, input: ResolveInput): ResolvePlan {
  // Anything the customer has handed over, banked or not: a check sitting in
  // the safe is money we are holding and would have to give back, exactly like
  // cash. Only `pending` is money that never arrived.
  const collected = sale.installments.filter((i) => wasCollected(i.status))
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

  // The sales side and the stock side are two different questions. A return
  // comes off net sales in full whatever happened to the money - see
  // netSaleVolume in metrics.ts. Only a return whose fuel came back puts
  // litres back in the tank - see restockedVolume there. Both rules are kept
  // in the same shape here so this preview and the figures agree.
  const returned = input.kind === 'returned' ? volumeReturned ?? sale.volumeLiters : 0
  const backToStock = input.kind === 'returned' ? input.backToStock ?? true : false
  const restocked = backToStock ? returned : 0

  return {
    patch: {
      status: input.kind,
      installments,
      resolution: {
        date: input.date,
        reason: input.reason.trim(),
        treatment: input.treatment,
        ...(input.kind === 'returned' ? { backToStock } : {}),
        ...(volumeReturned !== undefined ? { volumeReturned } : {}),
        // Recorded so Revert can put the order back where it was rather than
        // guessing. See OrderResolution.previousStatus.
        previousStatus: sale.status,
        ...(input.recordedBy ? { recordedBy: input.recordedBy } : {}),
      },
    },
    cancelledInstallments,
    collectedAmount,
    returnedVolume: returned,
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
