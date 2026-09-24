import { fmtCurrency, fmtDate, fmtLiters } from '../../lib/format'
import { isInstallmentOverdue, saleInstallmentEntries, stockFor } from '../../lib/metrics'
import { recordHref } from '../../lib/deepLink'
import type {
  Customer, Delivery, Personnel, Product, Purchase, Sale, StockThreshold, Warehouse,
} from '../../data/types'
import { productName } from '../../lib/products'

/**
 * The rows behind the Needs attention block on Home.
 *
 * Kept as a pure function, separate from the component, for two reasons. It is
 * the only place in the app that reads across every module at once, so the
 * selection rules deserve to be tested directly rather than through a render.
 * And the module filtering happens here: the caller passes empty arrays for
 * anything the seat cannot see, exactly as the cash calendar already does, so a
 * Logistics seat cannot be shown a peso figure by a layout change further up.
 *
 * Nothing here is a notification. Every row names a record and links to it.
 */

export type AttentionGroup = 'act' | 'today'
export type AttentionTone = 'act' | 'watch' | 'plain'

export interface AttentionRow {
  key: string
  group: AttentionGroup
  /** Which module the row came from, shown as the row's left-hand label. */
  tag: string
  title: string
  detail: string
  /**
   * How long this has been waiting, as its own column.
   *
   * It used to be glued onto `value` - "P950,220 - 43 days over" - so one cell
   * carried two unrelated quantities and neither could line up with the row
   * above it. They are different questions ("how big" and "how long"), they
   * want different alignment, and only one of them is money. Empty where the
   * row has no age worth stating: a depot below its level is short now, and a
   * trip scheduled for today has not aged at all.
   */
  age: string
  /** The one figure the row is about: the amount due, the litres short. */
  value: string
  tone: AttentionTone
  href: string
  /** The verb for the row's link - "Open" unless something more specific fits.
   *  Not printed any more: it names the icon for hover and for screen readers. */
  cta: string
}

export interface AttentionInput {
  /** Pass [] for any collection the seat's modules do not cover. */
  sales: Sale[]
  purchases: Purchase[]
  deliveries: Delivery[]
  customers: Customer[]
  personnel: Personnel[]
  warehouses: Warehouse[]
  products: Product[]
  stockThresholds: StockThreshold[]
  /** Pending approvals awaiting this seat's decision; [] when it cannot approve. */
  approvals: { requestedByName: string; requestedAt: string; tbl: string }[]
  /** Injected so the result is deterministic under test. */
  today: string
}

/** Whole days between two yyyy-MM-dd strings, floor at 0. */
function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(fromIso.slice(0, 10))
  const b = Date.parse(toIso.slice(0, 10))
  return Math.max(0, Math.round((b - a) / 86_400_000))
}

/** Most overdue receivables shown individually before the rest are summarised.
 * Three names is enough to act on; a list of twelve is a report, and there is
 * already a page for that. */
const NAMED_OVERDUE = 3

export function attentionRows(input: AttentionInput): AttentionRow[] {
  const rows: AttentionRow[] = []
  const {
    sales, deliveries, customers, personnel, warehouses, products,
    stockThresholds, purchases, approvals, today,
  } = input

  // ---- Act now ------------------------------------------------------------

  // Overdue receivables, biggest first. `isInstallmentOverdue` is the same
  // predicate the collection board and the cash calendar use, so a row here can
  // never disagree with the page it links to.
  const overdue = saleInstallmentEntries(sales)
    .filter((e) => e.installment.status === 'pending' && isInstallmentOverdue(e.installment))
    .sort((a, b) => b.installment.amount - a.installment.amount)

  for (const e of overdue.slice(0, NAMED_OVERDUE)) {
    const customer = customers.find((c) => c.id === e.sale.customerId)
    const seq = e.sale.installments.findIndex((i) => i.id === e.installment.id) + 1
    const collectorId = e.installment.collectorId ?? e.sale.collectorId
    const collector = personnel.find((p) => p.id === collectorId)
    const late = daysBetween(e.installment.dueDate, today)
    rows.push({
      key: `overdue-${e.installment.id}`,
      group: 'act',
      tag: 'Collect',
      title: customer?.company ?? 'Unknown customer',
      detail: [
        e.sale.installments.length > 1 ? `Installment ${seq} of ${e.sale.installments.length}` : 'Single payment',
        `due ${fmtDate(e.installment.dueDate)}`,
        collector ? `${collector.name} collecting` : 'unassigned',
      ].join(' · '),
      age: `${late} day${late === 1 ? '' : 's'} over`,
      value: fmtCurrency(e.installment.amount).replace('.00', ''),
      tone: 'act',
      href: recordHref('sales', e.sale.id) ?? '/collection',
      cta: 'Open',
    })
  }
  if (overdue.length > NAMED_OVERDUE) {
    const rest = overdue.slice(NAMED_OVERDUE)
    const total = rest.reduce((sum, e) => sum + e.installment.amount, 0)
    rows.push({
      key: 'overdue-rest',
      group: 'act',
      tag: 'Collect',
      title: `${rest.length} more overdue installment${rest.length === 1 ? '' : 's'}`,
      detail: 'Smaller amounts, same rule',
      // Many different ages rolled into one row; no single number is honest.
      age: '',
      value: fmtCurrency(total),
      tone: 'act',
      href: '/collection',
      cta: 'Open',
    })
  }

  // Depots below their warning level. Same computation as the server's 2.3
  // check, so the row and the notification agree.
  const short = stockThresholds
    .filter((t) => t.active !== false)
    .map((t) => {
      const onHand = stockFor(purchases, sales, t.warehouseId, t.productId)
      return { threshold: t, onHand, short: t.thresholdLiters - onHand }
    })
    .filter((r) => r.short > 0)
    .sort((a, b) => b.short - a.short)

  for (const r of short) {
    const warehouse = warehouses.find((w) => w.id === r.threshold.warehouseId)
    rows.push({
      key: `low-${r.threshold.id}`,
      group: 'act',
      tag: 'Stock',
      title: `${warehouse?.name ?? 'Unknown depot'} below its warning level`,
      detail: `${fmtLiters(Math.max(r.onHand, 0))} on hand · warns below ${fmtLiters(r.threshold.thresholdLiters)} · ${productName(products, r.threshold.productId)}`,
      // A depot is not late, it is short. There is no clock on this one.
      age: '',
      value: `${fmtLiters(r.short)} short`,
      tone: 'act',
      href: '/inventory/warnings',
      cta: 'Open',
    })
  }

  // Parked inputs. This is also the only link to /settings/approvals anywhere in
  // the app - the page was built and reachable only by typing the URL.
  if (approvals.length > 0) {
    const names = [...new Set(approvals.map((a) => a.requestedByName))]
    const oldest = approvals.reduce((a, b) => (a.requestedAt <= b.requestedAt ? a : b))
    const waited = daysBetween(oldest.requestedAt, today)
    rows.push({
      key: 'approvals',
      group: 'act',
      tag: 'Approvals',
      title: `${approvals.length} input${approvals.length === 1 ? '' : 's'} parked for your approval`,
      detail: `${names.slice(0, 3).join(', ')}${names.length > 3 ? ` and ${names.length - 3} more` : ''}`,
      age: waited === 0 ? 'since today' : `${waited} day${waited === 1 ? '' : 's'} waiting`,
      value: '',
      tone: 'plain',
      href: '/settings/approvals',
      cta: 'Review',
    })
  }

  // ---- Today --------------------------------------------------------------

  // Scheduled for today and still sitting at the depot. 'loading' counts as
  // moving; 'scheduled' does not.
  const todayTrips = deliveries.filter((d) => d.scheduleDate.slice(0, 10) === today)
  const notMoving = todayTrips.filter((d) => d.status === 'scheduled')
  if (notMoving.length > 0) {
    const named = notMoving
      .map((d) => customers.find((c) => c.id === sales.find((s) => s.id === d.saleId)?.customerId)?.company)
      .filter((n): n is string => !!n)
    rows.push({
      key: 'trips-not-moving',
      group: 'today',
      tag: 'Trips',
      title: `${notMoving.length} of ${todayTrips.length} deliveries not yet loaded`,
      detail: named.length > 0
        ? `${named.slice(0, 3).join(' · ')}${named.length > 3 ? ` and ${named.length - 3} more` : ''}`
        : 'No customer recorded on these movements',
      // Scheduled for today, so there is nothing to count yet.
      age: '',
      value: `${todayTrips.length - notMoving.length} of ${todayTrips.length} moving`,
      tone: 'watch',
      href: '/logistics',
      cta: 'Open',
    })
  }

  // Confirmed and nobody has planned how it gets there. A sale can be confirmed
  // for days before anyone notices no truck is attached to it.
  const scheduled = new Set(deliveries.map((d) => d.saleId))
  const unplanned = sales
    // A pickup is not waiting on a truck - the customer collects it - so it can
    // never have a delivery, and counting one here put a row on the dashboard
    // that nobody could ever clear. It aged for as long as the sale existed.
    .filter((s) => s.status === 'confirmed' && s.fulfillment !== 'pickup' && !scheduled.has(s.id))
    .sort((a, b) => a.date.localeCompare(b.date))
  if (unplanned.length > 0) {
    const volume = unplanned.reduce((sum, s) => sum + s.volumeLiters, 0)
    rows.push({
      key: 'sales-unplanned',
      group: 'today',
      tag: 'Sales',
      title: `${unplanned.length} confirmed sale${unplanned.length === 1 ? '' : 's'} with no delivery scheduled`,
      detail: `Oldest confirmed ${fmtDate(unplanned[0].date)}`,
      age: (() => {
        const d = daysBetween(unplanned[0].date, today)
        return d === 0 ? 'since today' : `${d} day${d === 1 ? '' : 's'} waiting`
      })(),
      value: fmtLiters(volume),
      tone: 'plain',
      href: '/sales',
      cta: 'Open',
    })
  }

  return rows
}
