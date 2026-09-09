import { AGING_BUCKETS, agingBucketOf, saleInstallmentEntries, type AgingBucket } from '../../lib/metrics'
import type { Sale } from '../../data/types'

/**
 * The open receivable, split into ageing buckets.
 *
 * The buckets are `agingBucketOf` from metrics.ts - the same function the
 * Collections balances report ages by. This file used to define its own, with
 * four buckets to that report's five, so the same receivable was "Over 60 days"
 * on Home and split across "61-90" and "90+" on Collections. Two answers to
 * "how much is more than ninety days late", depending which page was open. They
 * also rounded differently, which could disagree at a bucket edge.
 *
 * Only the labels are local now, because a card half the width of the page
 * cannot carry the report's column headings.
 */

const LABELS: Record<AgingBucket, string> = {
  'current': 'Not yet due',
  '1-30': '1 to 30 days',
  '31-60': '31 to 60 days',
  '61-90': '61 to 90 days',
  '90+': 'Over 90 days',
}

/** Amber is watch, red is act - the same rule the rest of the app follows. */
const TONES: Record<AgingBucket, string> = {
  'current': 'bg-teal',
  '1-30': 'bg-amber',
  '31-60': 'bg-amber',
  '61-90': 'bg-redf',
  '90+': 'bg-redf',
}

export interface AgeingRow {
  key: AgingBucket
  label: string
  tone: string
  count: number
  amount: number
}

export function ageingRows(sales: Sale[], today: string): {
  rows: AgeingRow[]
  total: number
  count: number
  overdue: number
} {
  const open = saleInstallmentEntries(sales).filter((e) => e.installment.status === 'pending')
  const total = open.reduce((sum, e) => sum + e.installment.amount, 0)

  const rows: AgeingRow[] = AGING_BUCKETS.map((key) => {
    const inBucket = open.filter((e) => agingBucketOf(e.installment.dueDate, today) === key)
    return {
      key,
      label: LABELS[key],
      tone: TONES[key],
      count: inBucket.length,
      amount: inBucket.reduce((sum, e) => sum + e.installment.amount, 0),
    }
  })

  return {
    rows,
    total,
    count: open.length,
    overdue: rows.filter((r) => r.key !== 'current').reduce((sum, r) => sum + r.amount, 0),
  }
}
