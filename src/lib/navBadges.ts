import { depositOverdue, isInstallmentOverdue, purchaseInstallmentEntries, saleInstallmentEntries, stockFor, undepositedItems } from './metrics'
import type { Delivery, Purchase, Sale, StockThreshold } from '../data/types'

/**
 * The numbers beside the sidebar's rows: how many things on each screen are
 * waiting for someone.
 *
 * Each one is the same predicate its screen uses for the same thing - the
 * Collect queue's "overdue", the Treasury's "late to bank", the stock
 * warnings page's "below level" - so a badge never says 3 and the page 2.
 * Only counts of things that are late or blocked; a badge that counted
 * ordinary work (every open sale, every trip this week) would be a number
 * on every row and would mean nothing.
 *
 * Keyed by the row's path: a subpage's badge sits on the subpage, and the
 * module row shows the sum of its subpages so a folded section still says
 * how much is inside.
 */
export type NavBadges = Record<string, number>

export interface NavBadgeSources {
  sales?: Sale[]
  purchases?: Purchase[]
  deliveries?: Delivery[]
  stockThresholds?: StockThreshold[]
}

export function navBadges(src: NavBadgeSources, today = new Date().toISOString().slice(0, 10)): NavBadges {
  const out: NavBadges = {}
  const put = (path: string, n: number) => { if (n > 0) out[path] = n }

  if (src.sales) {
    // Collect → Queue: due and not yet collected, past its date.
    put('/collection', saleInstallmentEntries(src.sales)
      .filter((e) => e.installment.status === 'pending' && isInstallmentOverdue(e.installment)).length)
    // Treasury → Deposits: in hand and could have been banked already.
    put('/treasury', undepositedItems(src.sales).filter((e) => depositOverdue(e.depositDue)).length)
    // Sales: drafts waiting to be confirmed.
    put('/sales', src.sales.filter((s) => s.status === 'draft').length)
  }

  if (src.purchases) {
    // Treasury → Payables: owed to a supplier and past its date.
    put('/treasury/payables', purchaseInstallmentEntries(src.purchases)
      .filter((e) => e.installment.status === 'pending' && isInstallmentOverdue(e.installment)).length)
  }

  if (src.deliveries) {
    // Trips → Board: scheduled day has passed and the trip is still open.
    put('/logistics', src.deliveries
      .filter((d) => (d.status === 'scheduled' || d.status === 'loading' || d.status === 'in_transit') && d.scheduleDate.slice(0, 10) < today)
      .length)
  }

  if (src.stockThresholds && src.purchases && src.sales) {
    // Stock → Warnings: depots below their warning level.
    put('/inventory/warnings', src.stockThresholds
      .filter((t) => t.active !== false)
      .filter((t) => t.thresholdLiters - stockFor(src.purchases!, src.sales!, t.warehouseId, t.productId) > 0)
      .length)
  }

  return out
}

/** A module row's number: its own, plus its subpages'. */
export function badgeFor(badges: NavBadges, to: string, children: { to: string }[] = []): number {
  const own = badges[to] ?? 0
  const kids = children.filter((c) => c.to !== to).reduce((s, c) => s + (badges[c.to] ?? 0), 0)
  return own + kids
}
