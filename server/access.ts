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
  // Collection settles installments on the sale record itself, and Logistics
  // marks a trip delivered which writes back to the sale.
  sales: ['sales', 'collection', 'logistics'],
  // Confirming a sale books its delivery trip, so a sales seat creates one.
  deliveries: ['logistics', 'sales'],
  purchases: ['inventory'],
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
