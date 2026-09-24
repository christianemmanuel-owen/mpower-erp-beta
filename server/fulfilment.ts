import { getRow, now, putStmt, type Rec, type Seat } from './core'
import * as audit from './audit'

/**
 * A delivered truck is what finishes a delivery sale.
 *
 * The office Trips page used to do this from the browser after moving the
 * trip, and the driver's phone did not do it at all - so a delivery the crew
 * confirmed on site left its sale sitting at "confirmed" until someone in the
 * office noticed. And when the office did it, the sale write was a second
 * request that could be parked for approval on its own, leaving a delivered
 * trip and an unfulfilled sale for however long the approver took.
 *
 * It is one fact, so it is one write: made wherever the delivery lands in the
 * table - the direct PUT, or an approval being applied - by whoever was
 * allowed to land it. Only `confirmed` moves; a cancelled or returned sale is
 * someone's decision and a late truck does not overrule it.
 */
export async function fulfilOnDelivery(
  db: D1Database,
  seat: Seat,
  before: Rec | null | undefined,
  after: Rec | null | undefined,
): Promise<boolean> {
  if (!after || after.status !== 'delivered' || before?.status === 'delivered' || !after.saleId) return false
  const sale = await getRow(db, 'sales', String(after.saleId))
  if (!sale || sale.status !== 'confirmed') return false
  const fulfilled: Rec = { ...sale, status: 'fulfilled', updatedAt: now() }
  await putStmt(db, 'sales', fulfilled).run()
  await audit.record(db, { seat, action: 'update', tbl: 'sales', recordId: String(fulfilled.id), before: sale, after: fulfilled })
  return true
}
