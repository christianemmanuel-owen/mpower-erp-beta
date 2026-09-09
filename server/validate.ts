/**
 * Server-side validation for the record tables.
 *
 * The route copied the request body verbatim into storage: `{...body, id,
 * createdAt, updatedAt}`. Every rule the app relies on lived in the form. The
 * consequences were not theoretical:
 *
 *   - `status` was client-supplied, so POST /api/sales {"status":"fulfilled"}
 *     created a sale that never passed draft to confirm, therefore had no
 *     delivery trip, and counted toward stock, revenue and agent quota the
 *     moment it landed.
 *   - `collectedAt` was client-supplied, and it drives both the commission
 *     payroll period and the customer's punctuality score, so it could be
 *     backdated into a closed period.
 *   - Volumes and prices were unbounded, negatives included.
 *
 * This is deliberately a floor, not a schema layer. It rejects values that
 * cannot be legitimate rather than trying to re-derive the record, because a
 * validator that recomputes totals has to agree with the client about rounding
 * forever, and that is how you get writes that fail for honest users.
 */

export type Rec = Record<string, unknown>

const STATUSES: Record<string, readonly string[]> = {
  sales: ['draft', 'confirmed', 'fulfilled', 'cancelled', 'returned'],
  purchases: ['ordered', 'received'],
  deliveries: ['scheduled', 'loading', 'in_transit', 'delivered', 'failed'],
}

/** Statuses a record may be CREATED with. A sale becomes confirmed by being
 * confirmed, which books its delivery trip; arriving already fulfilled skips
 * that and leaves an order with no trip behind it. */
const CREATE_STATUSES: Record<string, readonly string[]> = {
  sales: ['draft', 'confirmed'],
  purchases: ['ordered'],
  deliveries: ['scheduled'],
}

/** Fields that must be a finite number and never negative. */
const NON_NEGATIVE: Record<string, readonly string[]> = {
  sales: ['volumeLiters', 'pricePerLiter'],
  purchases: ['volumeLiters', 'pricePerLiter', 'volumeReceived'],
  stockThresholds: ['thresholdLiters'],
}

export interface Problem { field: string; message: string }

function checkNumbers(tbl: string, body: Rec): Problem[] {
  const out: Problem[] = []
  for (const field of NON_NEGATIVE[tbl] ?? []) {
    const v = body[field]
    if (v === undefined || v === null) continue
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      out.push({ field, message: `${field} must be a number.` })
    } else if (v < 0) {
      out.push({ field, message: `${field} cannot be negative.` })
    }
  }
  return out
}

function checkInstallments(body: Rec): Problem[] {
  const list = body.installments
  if (list === undefined) return []
  if (!Array.isArray(list)) return [{ field: 'installments', message: 'installments must be a list.' }]
  const out: Problem[] = []
  list.forEach((raw, i) => {
    const item = raw as Rec
    for (const field of ['principal', 'amount']) {
      const v = item[field]
      if (v === undefined) continue
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
        out.push({ field: `installments[${i}].${field}`, message: `${field} must be a number of zero or more.` })
      }
    }
  })
  return out
}

/**
 * Problems with a write, or an empty list.
 *
 * `mode` matters: the set of statuses a record may be created with is narrower
 * than the set it may later move through.
 */
export function validateRecord(tbl: string, body: Rec, mode: 'create' | 'update'): Problem[] {
  const problems: Problem[] = []

  const status = body.status
  if (typeof status === 'string') {
    const all = STATUSES[tbl]
    if (all && !all.includes(status)) {
      problems.push({ field: 'status', message: `${status} is not a valid status.` })
    } else if (mode === 'create') {
      const allowedNow = CREATE_STATUSES[tbl]
      if (allowedNow && !allowedNow.includes(status)) {
        problems.push({ field: 'status', message: `A new record cannot start as ${status}.` })
      }
    }
  }

  problems.push(...checkNumbers(tbl, body))
  problems.push(...checkInstallments(body))
  return problems
}
