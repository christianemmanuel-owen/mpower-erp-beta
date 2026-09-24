import type { CollectionStatus } from '../data/types'

/**
 * The questions the rest of the app actually asks about a payment's state.
 *
 * Before the deposit and clearing states existed, `status === 'collected'`
 * answered all of them at once: the collector had done their job, the money
 * was in the bank, and the receivable was closed were the same fact. They are
 * three different facts now, and roughly fifteen places in the codebase were
 * asking one of them while testing for another.
 *
 * So the comparisons live here as named questions rather than as string
 * equality spread across modules. Adding a seventh state later then means
 * answering these questions for it in one file, instead of hunting for
 * `=== 'collected'`.
 */

/** In the collector's hands, not yet at the bank. The undeposited float. */
export const isInHand = (s: CollectionStatus) => s === 'collected'

/** Lodged with the bank, outcome not yet known. */
export const isInClearing = (s: CollectionStatus) => s === 'deposited'

/**
 * The money is real and spendable.
 *
 * The only state that settles a receivable. Revenue, cash-in and commission
 * hang off this one, because everything earlier can still be refused.
 */
export const isSettled = (s: CollectionStatus) => s === 'cleared'

/**
 * The collector got something from the customer.
 *
 * True from the moment it is in hand and stays true through banking, because
 * the collector's part doesn't un-happen when the cashier takes over. This is
 * the question punctuality and on-time rate ask - they are about the person,
 * not the bank.
 */
export const wasCollected = (s: CollectionStatus) =>
  s === 'collected' || s === 'deposited' || s === 'cleared'

/**
 * Still owed to us.
 *
 * A check in hand and a check in clearing are both money the customer has not
 * actually paid yet - the bank can still refuse either. They leave the
 * collector's queue but stay on the account's balance until they clear, which
 * means a bounce needs no reversal: nothing was ever settled.
 */
export const isOutstanding = (s: CollectionStatus) =>
  s === 'pending' || s === 'collected' || s === 'deposited'

/** Nothing further will happen to this on its own. */
export const isConcluded = (s: CollectionStatus) =>
  s === 'cleared' || s === 'bounced' || s === 'cancelled'

/** Past the collector and now Treasury's to move. */
export const isCashDeskWork = (s: CollectionStatus) =>
  s === 'collected' || s === 'deposited'
