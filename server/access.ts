/**
 * Who may write which records.
 *
 * The route already had `canWriteTable`, and it was correct - but it was only
 * ever passed to the attachment handler. The generic CRUD block never called
 * it, so module access was enforced on a sale's scanned PO and not on the sale.
 * Any seat with a valid session, including one holding no modules at all, could
 * PUT or DELETE every sale, customer, purchase and trip in the system. The
 * client-side Guard blocks the route, not the endpoint.
 *
 * This lives in its own file, as a pure function over a plain seat shape, so it
 * can be tested without standing up a Worker.
 *
 * ## Writes are gated; reads deliberately are not
 *
 * Every page in this app joins across modules: Sales reads purchases and
 * customers, Inventory reads sales and customers, Logistics reads sales, the
 * dashboard reads nearly everything. Gating reads by module would break all of
 * them, and doing it properly means per-page endpoints that return only what a
 * screen needs rather than whole tables. That is a real piece of work and it is
 * not this one. Writes are the dangerous half and they are gated here.
 */

/** A table may be written from more than one module, because some workflows
 * legitimately cross a boundary. Each entry says WHY, because the temptation
 * later will be to "tidy" these into one module each and break a flow. */
export const TABLE_WRITE_MODULES: Record<string, string[]> = {
  // Collection settles installments on the sale record itself, Logistics marks
  // a trip delivered which writes back to the sale, and Treasury banks the
  // installments Collection settled. Which FIELDS each of the last two may
  // touch is decided further down by installmentWriteProblem; this only says
  // they may reach the record at all. Without Treasury here, a treasurer's
  // deposit was refused as "no access to this module" before the field rule
  // ever ran - the seat could see the queue and could not act on it.
  sales: ['sales', 'collection', 'logistics', 'treasury'],
  // Confirming a sale books its delivery trip, so a sales seat creates one.
  deliveries: ['logistics', 'sales'],
  // Treasury pays the supplier installments that live on the purchase.
  purchases: ['inventory', 'treasury'],
  supplierQuotes: ['accounts'],
  customers: ['accounts'],
  suppliers: ['accounts'],
  trucks: ['logistics'],
  vehicleMaintenance: ['logistics'],
  truckBanRules: ['logistics'],
}

export interface AccessSeat {
  isAdmin?: boolean
  modules?: string[]
}

/**
 * May this seat write this table?
 *
 * Returns true for tables with no entry, which keeps master data and the
 * per-seat tables behaving exactly as before. The stricter table-specific rules
 * in the route (admin-only, HR-only, own-seat) still run on top of this; this
 * only adds the module check that was missing.
 */
export function canWriteRecord(seat: AccessSeat | null | undefined, tbl: string): boolean {
  if (!seat) return false
  if (seat.isAdmin) return true
  const allowed = TABLE_WRITE_MODULES[tbl]
  if (!allowed) return true
  const mine = seat.modules ?? []
  return allowed.some((m) => mine.includes(m))
}

/**
 * The desk a record belongs to: the one that may change anything on it.
 *
 * TABLE_WRITE_MODULES lets Collection, Logistics and Treasury reach a sale,
 * and Treasury a purchase, because the payments live on the record. It said
 * nothing about WHICH fields, so a treasurer who opened a sale from the
 * deposit queue could change its price and volume - the record-level door
 * was open and the field-level rule only watched the installments. The desk
 * that owns the record edits it; every other desk edits its payments and
 * nothing else.
 */
const OWNER_MODULE: Record<string, { module: string; desk: string; noun: string }> = {
  sales: { module: 'sales', desk: 'Sales', noun: 'sale' },
  purchases: { module: 'inventory', desk: 'Stock', noun: 'purchase' },
  // Sales books the trip when a sale is confirmed (a create, on the server's
  // own initiative); from then on it is dispatch's record. Crew seats hold
  // the logistics module, so the phone's own writes are the owner's and are
  // narrowed separately by crewFieldViolations.
  deliveries: { module: 'logistics', desk: 'Trips', noun: 'trip' },
}

/** Fields any desk with access may write: the payment plan, and nothing else. */
const SHARED_FIELDS = new Set(['installments', 'id', 'updatedAt', 'createdAt'])

export function foreignFieldProblem(
  seat: AccessSeat | null | undefined,
  tbl: string,
  existing: Record<string, unknown>,
  next: Record<string, unknown>,
): string | null {
  if (!seat) return 'Not signed in.'
  if (seat.isAdmin) return null
  const owner = OWNER_MODULE[tbl]
  if (!owner || (seat.modules ?? []).includes(owner.module)) return null
  const changed = Object.keys(next).filter((k) => !SHARED_FIELDS.has(k) && JSON.stringify(next[k]) !== JSON.stringify(existing[k]))
  if (changed.length === 0) return null
  return tbl === 'deliveries'
    ? `Only ${owner.desk} can change a ${owner.noun} - your seat can look at it, not edit it (${changed.join(', ')}).`
    : `Only ${owner.desk} can change a ${owner.noun} beyond its payments - your seat may record them, not edit the ${owner.noun} (${changed.join(', ')}).`
}

// ---- Segregation of duties on a collection ----------------------------------

/**
 * Who may write which part of an installment.
 *
 * Receiving money and banking it are the two halves of the oldest control in
 * bookkeeping. If one person can do both, lapping - covering what you took
 * today with what the next customer pays tomorrow - leaves no trace anywhere,
 * because the only record that the first payment ever existed is the one that
 * person wrote.
 *
 * Table-level gating cannot express this. A collection lives inside the sale
 * record, so `canWriteRecord` sees one table, `sales`, and both the collector
 * and the cashier legitimately write it. Hiding the deposit button from the
 * collector's screen is a courtesy to the honest, not a control on anyone
 * else. So the rule has to reach inside the record and ask which FIELDS moved.
 */
const COLLECTION_FIELDS = [
  'collectedAt', 'checkDate', 'referenceNo', 'notes', 'collectorId', 'collectionFormNo',
] as const
// `bankAccountId` is deliberately in neither list. A collector names the account
// a transfer landed in; a treasurer names the account a check was deposited to.
// Listing it under Collections refused every deposit the Treasury dialog
// recorded, with a message blaming the treasurer for changing the collection.
const TREASURY_FIELDS = [
  'depositedAt', 'depositedBy', 'depositSlipNo', 'clearedAt', 'clearedBy',
] as const

/**
 * Which desk may make each move.
 *
 * Keyed by the transition rather than by the destination, because `cleared`
 * is reached two different ways and they belong to different people. A bank
 * transfer is money the moment the customer sends it - there is nothing to
 * hold or present - so the collector recording it takes it straight from
 * pending to cleared in one step. A check reaches cleared only from deposited,
 * on the bank's say-so, and that is Treasury's to record. Letting either
 * desk write "cleared" regardless of where from would let a collector clear
 * their own check.
 *
 * `bounced` from `collected` belongs to the collector - a customer handing a
 * check back before it ever reached a branch - and from `deposited` to the
 * treasury, which hears it from the bank. Refusing either would mean a real
 * event nobody on shift is allowed to record.
 */
const MOVES: Record<string, string[]> = {
  'pending>collected': ['collection'],
  'pending>cleared': ['collection'],
  'pending>bounced': ['collection'],
  'pending>cancelled': ['collection'],
  'collected>pending': ['collection'],
  'collected>bounced': ['collection'],
  'collected>cancelled': ['collection'],
  'collected>deposited': ['treasury'],
  // Cash: banking it is the end of the story, there is no clearing to wait on.
  'collected>cleared': ['treasury'],
  'deposited>cleared': ['treasury'],
  'deposited>bounced': ['treasury'],
  'bounced>pending': ['collection'],
  'bounced>collected': ['collection'],
  'cancelled>pending': ['collection'],
}

interface InstallmentLike { id?: string; status?: string; [k: string]: unknown }

const has = (seat: AccessSeat, module: string) => (seat.modules ?? []).includes(module)

/**
 * What this seat is not allowed to have changed, or null if the write is fine.
 *
 * Returns a message rather than a boolean because the refusal has to say which
 * desk the work belongs to - "not allowed" on a save that looked reasonable is
 * how people conclude the system is broken and start sharing logins, which
 * defeats the control far more thoroughly than a missing check would.
 *
 * A write that doesn't touch installments at all returns null immediately, so
 * Logistics marking a trip delivered and Sales editing a price are unaffected.
 */
export function installmentWriteProblem(
  seat: AccessSeat | null | undefined,
  before: unknown,
  after: unknown,
): string | null {
  if (!seat) return 'Not signed in.'
  if (seat.isAdmin) return null
  if (!Array.isArray(after)) return null

  const prev = new Map<string, InstallmentLike>(
    (Array.isArray(before) ? before : []).map((i: InstallmentLike) => [String(i?.id), i ?? {}]),
  )

  for (const next of after as InstallmentLike[]) {
    const old = prev.get(String(next?.id))
    // A brand-new installment is a payment plan being written, which is sales
    // and collections work; it carries no banking history to protect.
    if (!old) continue

    if (next.status !== old.status) {
      const move = `${old.status}>${next.status}`
      const owners = MOVES[move]
      if (!owners) return `A payment cannot go from ${old.status} to ${next.status}.`
      if (!owners.some((m) => has(seat, m))) {
        return owners.includes('treasury')
          ? 'Depositing and clearing are Treasury work - your seat records collections.'
          : 'Recording a collection is Collections work - your seat is on Treasury.'
      }
    }

    for (const f of TREASURY_FIELDS) {
      if (next[f] !== old[f] && !has(seat, 'treasury')) {
        return 'Only Treasury can record deposits and clearing.'
      }
    }
    for (const f of COLLECTION_FIELDS) {
      if (next[f] !== old[f] && !has(seat, 'collection')) {
        return 'Only Collections can change how a payment was collected.'
      }
    }
  }
  return null
}
