import { daysLate, isOverdue } from './credit'
import { installmentCollector } from './metrics'
import type { Sale, SaleInstallment } from '../data/types'

/**
 * Collection performance - Exhibit A 1.6, "percentage collected on time, per
 * solicitor, per client, and in aggregate".
 *
 * The three cuts are the same arithmetic over different groupings, so they share
 * one implementation. What matters is what goes into the ratio, and the rules
 * here mirror `creditHistory()` in src/lib/credit.ts deliberately - an account
 * that looks punctual on its own screen must not look late on the collector's.
 *
 *   - **Cancelled installments are excluded.** They were called off; that is not
 *     a collection outcome in either direction.
 *   - **Not-yet-due installments are excluded.** They have not had the chance to
 *     be late.
 *   - **A collection with no timestamp cannot be judged.** Counting it as on
 *     time flatters the collector; counting it as late punishes record-keeping
 *     rather than performance. It is excluded and reported separately, so the
 *     gap between `settled` and `judged` shows how much of the picture is
 *     actually being recorded.
 *   - **A bounced payment counts against the collector.** The money did not
 *     arrive. Whether that is the collector's fault is a management question,
 *     but the collection did not succeed, and a rate that ignored bounces would
 *     say otherwise.
 *
 * Attribution follows `installmentCollector()` - the installment's own collector
 * if set, otherwise the sale's. An installment with neither groups under
 * `collectorId: null`, which the UI shows as "Unassigned" rather than hiding:
 * unattributed collections are exactly the ones that go unchased.
 */

export interface CollectionRate {
  /** Installments that reached an outcome or are visibly stuck. */
  concluded: number
  settled: number
  bounced: number
  openOverdue: number
  /** Settled installments that could be judged for timeliness. */
  judged: number
  onTime: number
  late: number
  /** onTime / (judged + bounced + openOverdue). Null when nothing concluded. */
  onTimeRate: number | null
  avgDaysLate: number | null
  /** Peso value settled, and value still outstanding past due. */
  settledAmount: number
  overdueAmount: number
}

interface Entry {
  sale: Sale
  installment: SaleInstallment
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** Every installment across every sale, paired with its parent. */
/**
 * Every installment that is, or was, actually collectable.
 *
 * Drafts and cancelled orders are excluded, for the same reason
 * `saleInstallmentEntries` in metrics.ts excludes them: a draft has nothing to
 * collect yet and a cancelled order has nothing to collect any more. This used
 * to take every installment on every sale, so an unconfirmed order's schedule
 * counted as money past its due date - it appeared in the on-time denominator
 * as work somebody failed to collect, when it had never been collectable at
 * all. It also put the page at odds with itself: the strip counted open
 * installments one way and the on-time figure counted them another, so the two
 * numbers disagreed on screen.
 */
export function installmentEntries(sales: Sale[]): Entry[] {
  return sales
    .filter((sale) => sale.status !== 'draft' && sale.status !== 'cancelled')
    .flatMap((sale) => sale.installments.map((installment) => ({ sale, installment })))
}

export function collectionRate(entries: Entry[], asOf = Date.now()): CollectionRate {
  const live = entries.filter((e) => e.installment.status !== 'cancelled')

  const settled = live.filter((e) => e.installment.status === 'collected')
  const bounced = live.filter((e) => e.installment.status === 'bounced')
  const overdue = live.filter((e) => isOverdue(e.installment, asOf))

  const timed = settled
    .map((e) => daysLate(e.installment))
    .filter((d): d is number => d !== null)
  const onTime = timed.filter((d) => d <= 0).length
  const lateDays = timed.filter((d) => d > 0)

  // The denominator is everything that has had its chance: judged collections,
  // bounces, and money still outstanding past its due date. Untimed collections
  // are left out of both sides rather than assumed good.
  const denominator = timed.length + bounced.length + overdue.length

  return {
    concluded: settled.length + bounced.length + overdue.length,
    settled: settled.length,
    bounced: bounced.length,
    openOverdue: overdue.length,
    judged: timed.length,
    onTime,
    late: lateDays.length,
    onTimeRate: denominator > 0 ? onTime / denominator : null,
    avgDaysLate: lateDays.length > 0 ? Math.round(lateDays.reduce((s, d) => s + d, 0) / lateDays.length) : null,
    settledAmount: round2(settled.reduce((s, e) => s + e.installment.amount, 0)),
    overdueAmount: round2(overdue.reduce((s, e) => s + e.installment.amount, 0)),
  }
}

export interface GroupedRate<K> {
  key: K
  rate: CollectionRate
}

function groupBy<K>(entries: Entry[], keyOf: (e: Entry) => K): Map<K, Entry[]> {
  const out = new Map<K, Entry[]>()
  for (const e of entries) {
    const k = keyOf(e)
    const bucket = out.get(k)
    if (bucket) bucket.push(e)
    else out.set(k, [e])
  }
  return out
}

/** Per solicitor. `key` is null for installments nobody is assigned to. */
/** The date an installment reports under: when it was collected, else when it fell due.
 * Collections already scoped its figures this way inline; naming it stops a second
 * screen from picking a different date and quietly disagreeing. */
export const entryReportDate = (e: Entry) => e.installment.collectedAt ?? e.installment.dueDate

/** Per collector. `keep` scopes it to a date window - without one this is a
 * lifetime figure, which is right on the Collectors board and wrong anywhere
 * sitting under a range picker. */
export function rateByCollector(sales: Sale[], asOf = Date.now(), keep?: (e: Entry) => boolean): GroupedRate<string | null>[] {
  const entries = keep ? installmentEntries(sales).filter(keep) : installmentEntries(sales)
  const grouped = groupBy(entries, (e) => installmentCollector(e.sale, e.installment))
  return [...grouped.entries()]
    .map(([key, entries]) => ({ key, rate: collectionRate(entries, asOf) }))
    .sort((a, b) => (b.rate.onTimeRate ?? -1) - (a.rate.onTimeRate ?? -1))
}

/** Per client. */
export function rateByCustomer(sales: Sale[], asOf = Date.now()): GroupedRate<string>[] {
  const grouped = groupBy(installmentEntries(sales), (e) => e.sale.customerId)
  return [...grouped.entries()]
    .map(([key, entries]) => ({ key, rate: collectionRate(entries, asOf) }))
    .sort((a, b) => (b.rate.onTimeRate ?? -1) - (a.rate.onTimeRate ?? -1))
}

/** In aggregate. */
export const rateOverall = (sales: Sale[], asOf = Date.now()) =>
  collectionRate(installmentEntries(sales), asOf)
