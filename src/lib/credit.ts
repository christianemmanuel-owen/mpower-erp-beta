import type { Customer, Sale, SaleInstallment } from '../data/types'
import { wasCollected } from './collectionStatus'

/**
 * Credit history and credit score - Exhibit A 1.4.
 *
 * The spec asks for two related but different things:
 *
 *   "Credit history, including **ease of collection** and **punctuality of
 *    payment**, derived from collection records"
 *
 *   "Credit score computed from ease of collection and punctuality, **per a
 *    formula to be confirmed in writing by the Parties** during scope
 *    finalization"
 *
 * So the two inputs are derivable today and the score is not. `creditScore()`
 * therefore returns `null` until the Client confirms the weighting, rather than
 * inventing one. A number on a screen labelled "credit score" is trusted - staff
 * will decline orders on it - and a made-up weighting would be trusted exactly
 * as much as an agreed one. An account can carry a manual `creditScoreOverride`
 * in the meantime, which is honest about being a human judgement.
 *
 * ## Punctuality
 *
 * Of the installments that were actually collected, how many landed on or before
 * their due date. This is a clean measurement: both dates are recorded.
 *
 * ## Ease of collection
 *
 * How much chasing the money took. This is the softer of the two, and the System
 * does not record follow-ups - no call log, no reminder count - so it cannot be
 * measured directly. What it can see is friction that left a trace:
 *
 *   - a payment that bounced
 *   - a payment that settled after its due date
 *   - a payment still outstanding past its due date
 *
 * Ease is the share of concluded installments with none of those. That is a
 * proxy, and it is worth saying so plainly: an account that pays on the last day
 * every time after four phone calls scores as "easy" here, because the calls
 * were never recorded. See Q14 in the gap analysis - if the Client wants ease of
 * collection measured rather than inferred, collection follow-ups need to become
 * records, which is a change to the Collection Module.
 *
 * ## A known blind spot
 *
 * An installment carries one status. A check that bounces and is then made good
 * ends as `collected`, and the bounce leaves no trace - so `bounced` counts only
 * payments sitting in that state right now, and history understates friction.
 * Fixing it properly means recording collection *attempts* rather than a single
 * outcome, which is the same change Q14 asks about.
 */

export type CreditRating = 'excellent' | 'good' | 'watch' | 'poor'

export interface CreditHistory {
  /** Installments considered - cancelled ones are excluded throughout: they were
   * called off, which is not a payment outcome either way. */
  considered: number
  settled: number
  onTime: number
  lateSettled: number
  bounced: number
  openOverdue: number
  overdueAmount: number
  /** Share of collected installments that landed on or before the due date. */
  punctuality: number | null
  /** Average days past due across the ones that were late; null if none were. */
  avgDaysLate: number | null
  /** Share of concluded installments that showed no friction at all. */
  ease: number | null
  /** Settled vs. settled-plus-still-overdue. Kept because the Accounts and
   * Collection screens have shown this figure since before the credit work. */
  onTimeRate: number | null
  rating: CreditRating | null
}

const DAY = 86_400_000

/** An installment is overdue when it is still pending and its due date has passed. */
export function isOverdue(i: SaleInstallment, asOf = Date.now()): boolean {
  return i.status === 'pending' && Date.parse(i.dueDate) < asOf
}

/**
 * Days between the due date and when the payment reached the collector.
 * Negative means early.
 *
 * Deliberately the in-hand date, not the clearing date: this figure judges
 * whether the customer paid on time and whether the collector went and got it,
 * and neither of them controls how long the bank takes. So it keeps counting
 * once the item moves on to deposited and cleared - the collection did not
 * un-happen when the cashier banked it.
 *
 * Null when we can't tell: a record collected before `collectedAt` existed has
 * no timestamp to compare, and guessing would fabricate punctuality.
 */
export function daysLate(i: SaleInstallment): number | null {
  if (!wasCollected(i.status) || !i.collectedAt) return null
  return Math.round((Date.parse(i.collectedAt) - Date.parse(i.dueDate)) / DAY)
}

export function creditHistory(installments: SaleInstallment[], asOf = Date.now()): CreditHistory {
  // Cancelled installments drop out entirely - see `considered` above.
  const live = installments.filter((i) => i.status !== 'cancelled')

  const collected = live.filter((i) => wasCollected(i.status))
  const bounced = live.filter((i) => i.status === 'bounced')
  const overdue = live.filter((i) => isOverdue(i, asOf))

  // Only installments with a recorded collection timestamp can be judged on
  // punctuality; the rest are counted nowhere rather than assumed on time.
  const timed = collected.map(daysLate).filter((d): d is number => d !== null)
  const onTime = timed.filter((d) => d <= 0).length
  const late = timed.filter((d) => d > 0)

  const punctuality = timed.length > 0 ? onTime / timed.length : null
  const avgDaysLate = late.length > 0 ? Math.round(late.reduce((s, d) => s + d, 0) / late.length) : null

  // "Concluded" for ease means everything that has reached an outcome or is
  // visibly stuck: collected, bounced, or overdue. Pending-but-not-yet-due
  // installments are excluded - they have not had the chance to be difficult.
  const concluded = collected.length + bounced.length + overdue.length
  const frictionless = timed.filter((d) => d <= 0).length + (collected.length - timed.length)
  const ease = concluded > 0 ? Math.max(0, Math.min(1, frictionless / concluded)) : null

  const onTimeRate = collected.length + overdue.length > 0
    ? collected.length / (collected.length + overdue.length)
    : null

  return {
    considered: live.length,
    settled: collected.length,
    onTime,
    lateSettled: late.length,
    bounced: bounced.length,
    openOverdue: overdue.length,
    overdueAmount: overdue.reduce((s, i) => s + i.amount, 0),
    punctuality,
    avgDaysLate,
    ease,
    onTimeRate,
    rating: ratingFrom(onTimeRate, overdue.length, bounced.length),
  }
}

/**
 * The letter grade shown on the account. This is NOT the credit score of Exhibit
 * A 1.4 - it is the coarse traffic light the Accounts and Collection screens
 * have always shown, kept deliberately blunt so nobody mistakes it for the
 * agreed formula.
 */
export function ratingFrom(onTimeRate: number | null, openOverdue: number, bounced: number): CreditRating | null {
  if (onTimeRate === null) return null
  let rating: CreditRating =
    onTimeRate >= 0.9 ? 'excellent' : onTimeRate >= 0.7 ? 'good' : onTimeRate >= 0.5 ? 'watch' : 'poor'
  // Anything currently unpaid or bounced caps the grade - a strong history does
  // not offset money that is outstanding right now.
  if ((openOverdue > 0 || bounced > 0) && (rating === 'excellent' || rating === 'good')) rating = 'watch'
  return rating
}

export interface CreditScore {
  value: number | null
  /** Where the number came from, so the UI never presents a human guess as a
   * computed figure. */
  source: 'formula' | 'manual' | 'unavailable'
  explanation: string
}

/**
 * Exhibit A 1.4's credit score. Returns null until the Parties confirm the
 * formula in writing - see the note at the top of this file for why this is
 * deliberate rather than unfinished.
 */
export function creditScore(customer: Customer, _history: CreditHistory): CreditScore {
  if (typeof customer.creditScoreOverride === 'number') {
    return {
      value: customer.creditScoreOverride,
      source: 'manual',
      explanation: 'Set by hand on this account. Not computed from collection records.',
    }
  }
  return {
    value: null,
    source: 'unavailable',
    explanation:
      'Awaiting the scoring formula, to be confirmed in writing by the Parties. Ease of collection and punctuality below are derived from collection records and will feed it.',
  }
}

/**
 * Does this sale actually oblige the customer to pay?
 *
 * A DRAFT sale does not. Drafts are quotes and enquiries - staff key them in to
 * price something up, and their installment rows are a proposed schedule, not a
 * debt. Letting them into credit history means an untouched quote silently ages
 * past its notional due date and marks a customer down as overdue for money
 * nobody ever asked them for.
 *
 * A CANCELLED sale does not either; its installments are cancelled by the
 * resolution and excluded inside creditHistory regardless.
 *
 * A RETURNED sale does. The fuel may have gone back, but how the customer
 * handled the payments before that is exactly the behaviour this measures.
 */
export const createsObligation = (s: Sale) =>
  s.status === 'confirmed' || s.status === 'fulfilled' || s.status === 'returned'

/** Every installment that obliges one customer to pay, across all their sales. */
export function customerInstallments(customerId: string, sales: Sale[]): SaleInstallment[] {
  return sales
    .filter((s) => s.customerId === customerId && createsObligation(s))
    .flatMap((s) => s.installments)
}

// ---- Account activity (Exhibit A 1.4) --------------------------------------

export interface AccountActivity {
  /** Draft orders - the closest thing the System records to an enquiry. See the
   * note below. */
  inquiries: number
  successful: number
  cancelled: number
  returned: number
}

/**
 * Account activity within an interval - "number of inquiries, successful orders,
 * cancelled orders, and returned orders".
 *
 * Three of the four are exact. **Inquiries are counted as draft orders**, which
 * is an interpretation: the System has no enquiry record, and a draft sale is
 * what staff create when a customer asks for a price without committing. It
 * undercounts every enquiry that was answered verbally and never keyed in. If
 * the Client wants true enquiry tracking, that is a new record type rather than
 * a different count - see Q15 in the gap analysis.
 */
export function accountActivity(
  customerId: string,
  sales: Sale[],
  inInterval: (isoDate: string) => boolean,
): AccountActivity {
  const own = sales.filter((s) => s.customerId === customerId && inInterval(s.date))
  return {
    inquiries: own.filter((s) => s.status === 'draft').length,
    successful: own.filter((s) => s.status === 'confirmed' || s.status === 'fulfilled').length,
    cancelled: own.filter((s) => s.status === 'cancelled').length,
    returned: own.filter((s) => s.status === 'returned').length,
  }
}
