import { installmentTotal } from '../components/InstallmentEditor'
import type { Purchase, PurchaseInstallment } from '../data/types'

/**
 * What MPower owes after a delivery that didn't match the order - Q13.
 *
 * The Client's position is that a short delivery reduces what is payable: you
 * pay for the fuel that arrived, not the fuel that was ordered. The purchase's
 * installment plan, though, is written when the order is placed, from the
 * ordered volume. So receiving has to reconcile the two.
 *
 * The rule:
 *
 *   payable          = volume received × agreed price per liter
 *   already paid     = principals of installments marked paid - money has moved,
 *                      so these are never rewritten
 *   remaining payable = payable − already paid, spread across the still-pending
 *                      installments in proportion to their current principals
 *
 * Proportional spreading is what keeps a negotiated plan recognisable: a 50/50
 * split stays 50/50, a 30/70 stays 30/70. Putting the whole shortfall on the
 * last installment would be simpler to explain but would quietly rewrite terms
 * the two parties agreed.
 *
 * Two properties worth stating, because both are load-bearing:
 *
 * 1. **It is idempotent.** The spread is always computed from the ORDERED total
 *    and the paid principals, never from the current pending principals - those
 *    are used only as weights. So receiving 9,650 and then correcting to 10,000
 *    restores the original plan rather than compounding the first adjustment.
 *
 * 2. **It never invents a negative debt.** If the delivery is worth less than
 *    what has already been paid, pending installments go to zero and the excess
 *    is reported as `overpaid` for a human to settle with the supplier - the
 *    System does not manufacture a refund it has no way to collect.
 *
 * Over-deliveries run through the same arithmetic in the other direction. That
 * is the symmetric reading of the Client's answer, but accepting and paying for
 * fuel nobody ordered is a commercial decision, so the receiving step shows the
 * adjustment and lets the user decline it.
 */

const round2 = (n: number) => Math.round(n * 100) / 100

export interface ReceiptAdjustment {
  /** The installments array as it should be written, paid/cancelled rows untouched. */
  installments: PurchaseInstallment[]
  /** Value of the order as placed. */
  orderedTotal: number
  /** Value of what actually arrived, at the agreed price. */
  receivedTotal: number
  /** Principals of installments already marked paid. */
  paidTotal: number
  /** What is left to pay after the adjustment - never negative. */
  remainingPayable: number
  /** receivedTotal − orderedTotal. Negative for a short delivery. */
  delta: number
  /** Amount paid above what the delivery turned out to be worth, if any. */
  overpaid: number
  /** False when there is no pending installment to move the difference onto. */
  adjustable: boolean
  /** True when the plan would actually change - lets callers stay quiet otherwise. */
  changed: boolean
}

/**
 * Works out the adjusted plan. Pure: takes the purchase as-ordered plus the
 * volume that arrived, returns what to write. Nothing here touches the network.
 */
export function planReceiptAdjustment(
  purchase: Pick<Purchase, 'volumeLiters' | 'pricePerLiter' | 'installments'>,
  receivedVolume: number,
): ReceiptAdjustment {
  const { volumeLiters, pricePerLiter, installments } = purchase

  const orderedTotal = round2(volumeLiters * pricePerLiter)
  const receivedTotal = round2(receivedVolume * pricePerLiter)
  const delta = round2(receivedTotal - orderedTotal)

  // Cancelled installments are out of the plan entirely - neither owed nor paid.
  const paidTotal = round2(
    installments.filter((i) => i.status === 'paid').reduce((s, i) => s + i.principal, 0),
  )
  const pending = installments.filter((i) => i.status === 'pending')

  const net = round2(receivedTotal - paidTotal)
  const overpaid = net < 0 ? round2(-net) : 0
  const remainingPayable = Math.max(net, 0)

  if (pending.length === 0) {
    // Nothing left to adjust: the plan is fully settled or fully cancelled. The
    // difference is real but has to be handled with the supplier directly, so
    // report it rather than silently dropping it.
    return {
      installments,
      orderedTotal, receivedTotal, paidTotal,
      remainingPayable, delta, overpaid,
      adjustable: false,
      changed: false,
    }
  }

  // Weights come from the current pending principals so the agreed shape of the
  // plan survives. When they are all zero - which happens after an adjustment
  // that zeroed them - fall back to an even split; there is no shape left to
  // preserve, and dividing by zero here would put NaN into a money field.
  const pendingTotal = pending.reduce((s, i) => s + i.principal, 0)
  const weights = pending.map((i) => (pendingTotal > 0 ? i.principal / pendingTotal : 1 / pending.length))

  const principals = weights.map((w) => round2(remainingPayable * w))
  // Rounding each share independently can leave the sum a centavo or two off.
  // Push the drift onto the last pending installment so the plan still sums to
  // exactly what is payable - an off-by-a-centavo plan looks like a bug forever.
  const drift = round2(remainingPayable - principals.reduce((s, p) => s + p, 0))
  if (principals.length > 0) {
    principals[principals.length - 1] = round2(principals[principals.length - 1] + drift)
  }

  const byId = new Map<string, number>()
  pending.forEach((i, idx) => byId.set(i.id, principals[idx]))

  const next = installments.map((i) => {
    const principal = byId.get(i.id)
    if (principal === undefined) return i
    return { ...i, principal, amount: installmentTotal(principal, i.interestPct) }
  })

  const changed = next.some((i, idx) => i.principal !== installments[idx].principal)

  return {
    installments: next,
    orderedTotal, receivedTotal, paidTotal,
    remainingPayable, delta, overpaid,
    adjustable: true,
    changed,
  }
}
