/**
 * Field seats: a login that is a person, and sees only that person's work.
 *
 * The office sees the business. A pahinante, a driver, a sales agent or a
 * collector signs in to do one job on records that name them, and everything
 * else in the module is somebody else's - another agent's customers, another
 * crew's trips. `Seat.scope = 'own'` says this is one of those seats;
 * `Seat.personnelId` says who.
 *
 * ## Why this is enforced here and not in the UI
 *
 * Reads elsewhere in this app are deliberately ungated (see access.ts): every
 * office page joins across modules, and gating them would break all of them.
 * That reasoning does not extend to a field seat. "Agents cannot see each
 * other's books" is a promise about confidentiality, and a promise kept only by
 * a filter in the client is not kept at all - the API would still hand the
 * whole sales table to anyone who asked it directly. So scoped seats are
 * filtered on the server, on the way out and on the way in.
 *
 * The scoping is deliberately narrow: it applies to the records a field seat
 * works on. Reference data - customers, depots, trucks, shifts - stays readable,
 * because an agent cannot write a sale against a customer they cannot see.
 */

export interface ScopeSeat {
  id?: string
  isAdmin?: boolean
  scope?: 'own' | 'all'
  /** The Personnel record this login is. Without it a scoped seat can match
   *  nothing, which is why the seat form refuses to save that combination. */
  personnelId?: string
  /** The Agent record this person sells under, resolved from their Personnel
   *  row when the session is loaded. Sales carry an agentId, not a personnelId. */
  agentId?: string
}

/** Tables a scoped seat only sees its own rows of. Everything else is either
 *  reference data or already gated by module and role. */
export const SCOPED_TABLES = new Set(['sales', 'deliveries'])

export const isScoped = (seat: ScopeSeat | null | undefined): boolean =>
  !!seat && seat.scope === 'own' && !seat.isAdmin

/** Every crew slot on a trip. A pahinante is as much "on" a trip as its driver. */
const CREW_FIELDS = ['driverId', 'pahinanteId', 'loaderId', 'guardId', 'managerId'] as const

type Row = Record<string, unknown>

/**
 * Is this record this seat's own work?
 *
 * A sale is theirs if they sold it or collect it; a trip is theirs if they are
 * crewed on it. Collections are installments inside a sale, so a collector's
 * scope is the sale that carries the installment they are assigned - there is
 * no separate record to scope.
 */
export function ownsRecord(seat: ScopeSeat, tbl: string, row: Row | null | undefined): boolean {
  if (!row) return false
  if (tbl === 'sales') {
    if (seat.agentId && row.agentId === seat.agentId) return true
    if (!seat.personnelId) return false
    if (row.collectorId === seat.personnelId) return true
    // An installment handed to this collector, on a sale sold by someone else.
    const installments = Array.isArray(row.installments) ? (row.installments as Row[]) : []
    return installments.some((i) => i.collectorId === seat.personnelId)
  }
  if (tbl === 'deliveries') {
    if (!seat.personnelId) return false
    return CREW_FIELDS.some((f) => row[f] === seat.personnelId)
  }
  return true
}

/** The rows of `tbl` this seat may see. A no-op for office seats. */
export function visibleRows<T extends Row>(seat: ScopeSeat | null | undefined, tbl: string, rows: T[]): T[] {
  if (!isScoped(seat) || !SCOPED_TABLES.has(tbl)) return rows
  return rows.filter((r) => ownsRecord(seat as ScopeSeat, tbl, r))
}

/**
 * May this seat write this record?
 *
 * `before` is the stored row (absent on create) and `after` is what it would
 * become. Both are checked, so a scoped seat cannot hand its own record to
 * somebody else, nor take over someone else's by writing their id out of it.
 */
export function mayWriteRecord(
  seat: ScopeSeat | null | undefined,
  tbl: string,
  before: Row | null | undefined,
  after: Row | null | undefined,
): boolean {
  if (!isScoped(seat) || !SCOPED_TABLES.has(tbl)) return true
  const s = seat as ScopeSeat
  if (before && !ownsRecord(s, tbl, before)) return false
  if (after && !ownsRecord(s, tbl, after)) return false
  return true
}

/**
 * The fields a field seat may change on a trip.
 *
 * Crew record what happened on the road: the checklist they signed, the stage
 * the trip reached, and the receipt at the far end. They do not reschedule
 * trips, reassign trucks, or re-crew themselves off a job - that is dispatch's
 * work, and letting a phone rewrite it turns an attestation into an edit.
 */
export const CREW_WRITABLE_DELIVERY_FIELDS = new Set([
  'status', 'checklist', 'stamps', 'documents', 'receivedBy', 'receivedOn', 'outcome', 'etaAt',
])

/** What a crew seat is trying to change beyond its remit, if anything. */
export function crewFieldViolations(before: Row, after: Row): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  const changed: string[] = []
  for (const k of keys) {
    if (k === 'id' || k === 'createdAt' || k === 'updatedAt') continue
    if (CREW_WRITABLE_DELIVERY_FIELDS.has(k)) continue
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) changed.push(k)
  }
  return changed
}
