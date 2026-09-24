import { netSaleVolume } from './metrics'
import { isSettled } from './collectionStatus'
import type { CommissionRate, Sale, SaleInstallment } from '../data/types'

/**
 * Commission, gated on collection - Exhibit A 1.7.
 *
 * The spec is unusually precise here: commission is "auto-computed from the
 * Sales Module **but approved for payout only once the corresponding collection
 * is recorded as collected**." The old implementation paid on *fulfilled* sales
 * and ignored collection entirely, which meant MPower paid commission on
 * receivables that might never arrive. That is the kind of miss that is quiet
 * for months and then expensive.
 *
 * Two decisions fall out of the gate, and both are worth stating because neither
 * is forced by the words alone.
 *
 * ## Commission follows the money, not the sale date
 *
 * The period a commission belongs to is the period the **collection** landed in,
 * not the one the sale was made in. This is not a preference - it is the only
 * arrangement that works. Commission computed on sales dated within the cutoff
 * but gated on collection would simply never pay: a January sale collected in
 * March is outside January's window (uncollected at the time) and outside
 * March's window (wrong sale date). The money would fall through the gap
 * silently, which is far worse than paying late.
 *
 * ## Part-collected sales pay proportionally
 *
 * An installment plan collects over months. Withholding the whole commission
 * until the final installment lands would mean an agent waits half a year on a
 * six-month plan. Instead each collected installment releases its own share, so
 * the agent is paid for money that actually arrived and nothing more. See Q17 -
 * the alternative reading ("no commission until the sale is fully settled") is
 * defensible and the Client may prefer it.
 *
 * ## What is excluded, and why
 *
 * - **Interest is not commissionable.** Each installment's `principal` is its
 *   share of the invoice value; `amount` may include a financing charge on top.
 *   Commission runs on principal - an agent did not sell the interest.
 * - **Cancelled sales pay nothing**, even if an installment somehow sits
 *   collected against one.
 * - **Returned sales pay on the part that stuck.** A half-returned order earns
 *   half, matching how `agentStats` credits quota. Fuel that went back was not
 *   sold.
 */

const r2 = (n: number) => Math.round(n * 100) / 100

export interface CommissionLine {
  saleId: string
  installmentId: string
  /** When the money arrived - the date that puts this in a payroll period. */
  collectedAt: string
  /** The invoice value this installment represents, net of returns. */
  commissionableAmount: number
  /** Litres attributable to this installment, net of returns. */
  commissionableLiters: number
  amount: number
}

/** Did this sale's collections earn commission at all? */
const commissionable = (s: Sale) => s.status !== 'cancelled' && s.status !== 'draft'

/**
 * The share of a sale that a single installment represents, scaled down by
 * anything that was returned.
 *
 * Returns are handled by scaling rather than by subtracting a flat figure so
 * that a partial return reduces every installment proportionally, instead of
 * wiping out whichever one happens to be collected first.
 */
function installmentShare(sale: Sale, inst: SaleInstallment) {
  const saleValue = sale.volumeLiters * sale.pricePerLiter
  if (saleValue <= 0 || sale.volumeLiters <= 0) {
    return { amount: 0, liters: 0 }
  }
  // netSaleVolume is 0 for cancelled/draft and reduced for a partial return.
  const keptFraction = netSaleVolume(sale) / sale.volumeLiters
  const share = inst.principal / saleValue
  return {
    amount: r2(saleValue * share * keptFraction),
    liters: sale.volumeLiters * share * keptFraction,
  }
}

/**
 * Every commission-earning collection for one agent within a period.
 *
 * Returned as lines rather than a total so a payslip can show its working - an
 * agent querying their commission wants to see which collections it came from.
 */
export function commissionLines(
  agentId: string,
  rate: CommissionRate,
  sales: Sale[],
  periodStart: string,
  periodEnd: string,
): CommissionLine[] {
  if (!agentId || !rate || rate.value <= 0) return []

  const lines: CommissionLine[] = []
  for (const sale of sales) {
    if (sale.agentId !== agentId || !commissionable(sale)) continue

    for (const inst of sale.installments) {
      // Cleared, not merely collected. Commission on a post-dated check that
      // later bounces is money out of the door against money that never came
      // in, and clawing it back off the next payslip is worse than waiting the
      // few days for the bank.
      if (!isSettled(inst.status)) continue
      // Placed in the period the money landed in, which is the clearing date.
      // Older records carry no clearing timestamp - they were written when
      // "collected" meant "in the bank" - so they fall back to the collection
      // date and then to the due date. Falling back is the honest guess: it is
      // what the record itself claims about when the money was expected, and
      // the alternative is dropping the commission entirely.
      const when = (inst.clearedAt ?? inst.collectedAt ?? inst.dueDate).slice(0, 10)
      if (when < periodStart || when > periodEnd) continue

      const share = installmentShare(sale, inst)
      if (share.amount <= 0) continue

      const amount = rate.kind === 'per_liter'
        ? share.liters * rate.value
        : share.amount * (rate.value / 100)

      lines.push({
        saleId: sale.id,
        installmentId: inst.id,
        collectedAt: inst.collectedAt ?? inst.dueDate,
        commissionableAmount: share.amount,
        commissionableLiters: r2(share.liters),
        amount: r2(amount),
      })
    }
  }
  return lines.sort((a, b) => a.collectedAt.localeCompare(b.collectedAt))
}

export const commissionTotal = (lines: CommissionLine[]) =>
  r2(lines.reduce((s, l) => s + l.amount, 0))

/**
 * Commission an agent has earned on paper but cannot be paid yet, because the
 * money has not arrived.
 *
 * Not used in payroll - it exists so the figure can be shown to an agent and a
 * manager. "You have ₱40,000 waiting on collection" is the number that makes the
 * gate feel like a rule rather than a mistake, and it is the number an agent
 * will otherwise compute by hand and argue about.
 */
export function pendingCommission(agentId: string, rate: CommissionRate, sales: Sale[]): number {
  if (!agentId || !rate || rate.value <= 0) return 0
  let total = 0
  for (const sale of sales) {
    if (sale.agentId !== agentId || !commissionable(sale)) continue
    for (const inst of sale.installments) {
      // Pending and bounced both mean the money is not in. Cancelled means it
      // never will be.
      if (inst.status !== 'pending' && inst.status !== 'bounced') continue
      const share = installmentShare(sale, inst)
      total += rate.kind === 'per_liter' ? share.liters * rate.value : share.amount * (rate.value / 100)
    }
  }
  return r2(total)
}
