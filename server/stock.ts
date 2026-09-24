/// <reference types="@cloudflare/workers-types" />
// Low supply warning - Secondary Feature 2.3.
//
// "A configurable stock threshold per product and warehouse that alerts the
// Client when stock falls below the specified amount. Extends the Inventory
// Module. Alerts are delivered via Push Notifications (2.11)."
//
// Two design choices worth stating.
//
// **When it evaluates.** Cloudflare Pages has no scheduled handler, so there is
// no cron to poll stock on. But polling would be the wrong shape anyway: stock
// only moves when a purchase is received or a sale is posted, so the check runs
// right there, on the write that moved it. No timer, no lag, no wasted reads.
//
// **What it alerts on.** The crossing, not the state. Stock sitting below the
// line for a fortnight raises one notification, not one per write - otherwise
// the alert becomes noise and gets ignored, which is worse than not having it.
// `lastAlertedAt` on the threshold record tracks that, and clears when stock
// recovers above the line so the next dip alerts again.

import { getRow, now, putStmt, tableRows, type Rec } from './core'
import * as notifications from './notifications'

/** Mirrors DEFAULT_PRODUCT_ID in src/data/types.ts. */
const DEFAULT_PRODUCT_ID = 'product-diesel'

const productKey = (productId: unknown): string =>
  typeof productId === 'string' && productId ? productId : DEFAULT_PRODUCT_ID

interface PurchaseRec extends Rec {
  status?: string
  warehouseId?: string
  productId?: string
  volumeLiters?: number
  volumeReceived?: number
}

interface SaleRec extends Rec {
  status?: string
  warehouseId?: string
  productId?: string
  volumeLiters?: number
  resolution?: { treatment?: string; volumeReturned?: number; backToStock?: boolean }
}

interface ThresholdRec extends Rec {
  id: string
  warehouseId?: string
  productId?: string
  thresholdLiters?: number
  active?: boolean
  lastAlertedAt?: string
}

/**
 * Volume a purchase actually brought in.
 *
 * DUPLICATED from receivedVolume() in src/lib/metrics.ts. The two must agree:
 * if they drift, the warning fires against a number no screen shows. They are
 * kept honest by src/lib/stockRules.test.ts, which runs both implementations
 * over the same cases and asserts they match. (They can't share a module - the
 * client and functions TypeScript projects don't overlap.)
 */
export function receivedVolume(p: PurchaseRec): number {
  if (p.status !== 'received') return 0
  return p.volumeReceived ?? p.volumeLiters ?? 0
}

/** DUPLICATED from restockedVolume() in src/lib/metrics.ts - see above. */
export function restockedVolume(s: SaleRec): number {
  if (s.status !== 'returned') return 0
  // New records say whether the fuel came back; older ones carried it as the
  // treatment. Refunded / credited / replaced say nothing about the fuel.
  const back = s.resolution?.backToStock ?? s.resolution?.treatment === 'restocked'
  if (!back) return 0
  const total = s.volumeLiters ?? 0
  return Math.min(s.resolution?.volumeReturned ?? total, total)
}

/** DUPLICATED from stockSaleVolume() in src/lib/metrics.ts - see above. This
 * is the STOCK basis (litres out of the tank), not net sales: a return whose
 * fuel did not come back is off the sales figure but still gone from stock. */
export function stockSaleVolume(s: SaleRec): number {
  const total = s.volumeLiters ?? 0
  if (s.status === 'returned') return Math.max(0, total - restockedVolume(s))
  return s.status === 'confirmed' || s.status === 'fulfilled' ? total : 0
}

/** Stock on hand for one warehouse and product, from the records table. */
export function stockFrom(
  purchases: PurchaseRec[],
  sales: SaleRec[],
  warehouseId: string,
  productId: string,
): number {
  let stock = 0
  for (const p of purchases) {
    if (p.warehouseId !== warehouseId || productKey(p.productId) !== productId) continue
    stock += receivedVolume(p)
  }
  for (const s of sales) {
    if (s.warehouseId !== warehouseId || productKey(s.productId) !== productId) continue
    stock -= stockSaleVolume(s)
  }
  return stock
}

/**
 * Re-checks the thresholds affected by a write and raises or clears warnings.
 *
 * Called after any write that could move stock. Never throws into the caller:
 * a failure here must not turn a successful purchase into an error the user
 * sees - the warning is a convenience, the purchase is the business record.
 *
 * `warehouseId` narrows the work to the warehouse that changed; passing nothing
 * checks them all (used after an import, where everything may have moved).
 */
export async function checkThresholds(
  db: D1Database,
  opts: { warehouseId?: string; productId?: string } = {},
): Promise<void> {
  try {
    const thresholds = (await tableRows(db, 'stockThresholds')) as ThresholdRec[]
    // Inactive thresholds are deliberately NOT filtered out here. They must
    // still reach the loop below so a stale `lastAlertedAt` gets cleared when a
    // warning is switched off - otherwise turning a warning off, letting stock
    // recover and dip again, then turning it back on leaves `lastAlertedAt` set
    // and the alert never fires again.
    const relevant = thresholds.filter(
      (t) =>
        typeof t.thresholdLiters === 'number' &&
        (!opts.warehouseId || t.warehouseId === opts.warehouseId) &&
        (!opts.productId || productKey(t.productId) === productKey(opts.productId)),
    )
    if (!relevant.length) return

    const [purchases, sales, warehouses] = await Promise.all([
      tableRows(db, 'purchases') as Promise<PurchaseRec[]>,
      tableRows(db, 'sales') as Promise<SaleRec[]>,
      tableRows(db, 'warehouses'),
    ])
    const warehouseName = (id: string) =>
      (warehouses.find((w) => w.id === id)?.name as string) ?? 'a warehouse'

    for (const t of relevant) {
      if (!t.warehouseId) continue
      const productId = productKey(t.productId)
      const level = stockFrom(purchases, sales, t.warehouseId, productId)
      const limit = t.thresholdLiters as number
      const below = level < limit

      const watching = t.active !== false

      if (watching && below && !t.lastAlertedAt) {
        await notifications.emit(db, { module: 'inventory' }, {
          kind: 'low_stock',
          title: 'Stock is running low',
          body: `${warehouseName(t.warehouseId)} is down to ${Math.round(level).toLocaleString()} L - below the ${Math.round(limit).toLocaleString()} L warning level.`,
          link: '/inventory',
          tbl: 'warehouses',
          recordId: t.warehouseId,
        })
        await putStmt(db, 'stockThresholds', { ...t, lastAlertedAt: now(), updatedAt: now() }).run()
      } else if ((!watching || !below) && t.lastAlertedAt) {
        // Recovered, or the warning was switched off - either way clear the flag
        // so the next dip below the level alerts again.
        const { lastAlertedAt: _cleared, ...rest } = t
        await putStmt(db, 'stockThresholds', { ...rest, updatedAt: now() }).run()
      }
    }
  } catch {
    // See the doc comment: warnings are best-effort.
  }
}

/** Tables whose writes can move stock, so the route knows when to re-check. */
export const STOCK_TABLES = new Set(['purchases', 'sales'])

/**
 * The warehouses a written record touches, so the check can be narrowed to them.
 *
 * Usually one. But editing a purchase to move it between depots - which the
 * Stock page fully supports - takes stock OUT of the old depot and puts it into
 * the new one. Checking only the destination would let the *source* slide below
 * its warning level in silence, which is exactly the case the warning exists
 * for. So when the stored record names a different warehouse than the write
 * does, both are returned.
 *
 * Falls back to the stored record when the write was a partial update that
 * didn't include warehouseId.
 */
export async function affectedWarehouses(
  db: D1Database,
  tbl: string,
  recordId: string,
  written: Rec,
): Promise<{ warehouseId?: string; productId?: string }[]> {
  const stored = await getRow(db, tbl, recordId)
  const storedWarehouse = stored?.warehouseId as string | undefined
  const storedProduct = stored ? productKey(stored.productId) : undefined

  if (typeof written.warehouseId !== 'string') {
    return storedWarehouse ? [{ warehouseId: storedWarehouse, productId: storedProduct }] : []
  }

  const target = { warehouseId: written.warehouseId, productId: productKey(written.productId) }
  if (!storedWarehouse || storedWarehouse === written.warehouseId) return [target]
  // Moved between depots: the one it left needs re-checking too.
  return [target, { warehouseId: storedWarehouse, productId: storedProduct }]
}
