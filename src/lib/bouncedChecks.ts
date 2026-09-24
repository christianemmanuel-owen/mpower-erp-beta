import type { Customer, Sale } from '../data/types'

/**
 * What a customer's bounced checks add up to, and what the law makes of it.
 *
 * Two laws, both worth knowing at the point of taking another check:
 *
 * - **B.P. 22, the Bouncing Checks Law.** Any check dishonoured for lack of
 *   funds is an offence on its own, whatever the amount - a fine of up to
 *   twice the check (capped at ₱200,000), imprisonment, or both. There is no
 *   minimum, so the first bounce is already actionable.
 * - **Estafa, Art. 315(2)(d) of the Revised Penal Code as re-priced by
 *   R.A. 10951 (2017).** A check issued to obtain goods that then bounces is
 *   estafa, and the penalty steps up with the amount defrauded: up to
 *   ₱40,000 is arresto mayor; over ₱40,000 to ₱1,200,000 reaches prisión
 *   correccional; over ₱1,200,000, ₱2,400,000 and ₱4,400,000 each step up
 *   again. ₱40,000 is therefore the line the client asked to be signalled
 *   at: past it, the exposure is no longer a small-claims matter.
 *
 * Neither is legal advice - the figures are the statute's brackets, dated,
 * so someone can check them.
 */
export const BOUNCED_LAW_AS_OF = '2026-09-19'

/** R.A. 10951 estafa brackets, the lower bound of each step in pesos. */
export const ESTAFA_STEPS = [40_000, 1_200_000, 2_400_000, 4_400_000] as const

/** The bracket a bounced total falls in: 0 below the first step. */
export const estafaStep = (amount: number) => ESTAFA_STEPS.filter((s) => amount > s).length

export interface BouncedSummary {
  count: number
  total: number
  /** 0 = under ₱40,000; 1+ = the R.A. 10951 step reached. */
  step: number
}

/** A customer's bounced installments across every sale, as a total. */
export function bouncedFor(customerId: Customer['id'], sales: Sale[]): BouncedSummary {
  let count = 0
  let total = 0
  for (const s of sales) {
    if (s.customerId !== customerId) continue
    for (const i of s.installments) {
      if (i.status !== 'bounced') continue
      count += 1
      total += i.amount
    }
  }
  return { count, total: Math.round(total * 100) / 100, step: estafaStep(total) }
}

/** One line for a badge or a rail note. */
export function bouncedNote(b: BouncedSummary): string | null {
  if (b.count === 0) return null
  const checks = `${b.count} bounced check${b.count === 1 ? '' : 's'}`
  if (b.step === 0) return `${checks} on file - each one is an offence under B.P. 22, whatever the amount.`
  return `${checks} totalling over ₱${ESTAFA_STEPS[b.step - 1].toLocaleString()} - past the R.A. 10951 line where estafa (Art. 315) carries prisión correccional or more, on top of B.P. 22.`
}
