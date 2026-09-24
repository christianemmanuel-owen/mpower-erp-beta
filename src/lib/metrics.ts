import type {
  ID,
  Agent, Customer, Delivery, Purchase, PurchaseInstallment, Sale, SaleInstallment, Supplier, SupplierQuote,
} from '../data/types'
import { CONSUMING_SALE_STATUSES } from '../data/types'
import { productKey } from './products'
import { creditHistory, customerInstallments, type CreditHistory, type CreditRating } from './credit'
import { isInClearing, isInHand, isOutstanding } from './collectionStatus'

/**
 * Does this sale move stock and money at all?
 *
 * Every stock, revenue and quota selector below asks this rather than testing
 * `status !== 'draft'`. That distinction mattered the moment Exhibit A 1.3 added
 * cancelled and returned orders: a cancelled sale is not a draft, so the old
 * test would have counted it as sold volume, drained stock that was never
 * shipped, and credited the agent's quota for an order that fell through.
 */
export const saleCounts = (s: Sale) => (CONSUMING_SALE_STATUSES as readonly string[]).includes(s.status)

/** Volume a return took off the order on paper - the whole order unless the
 * return was partial. Zero for anything that is not a returned order. */
export function returnedVolume(s: Sale): number {
  if (s.status !== 'returned') return 0
  return Math.min(s.resolution?.volumeReturned ?? s.volumeLiters, s.volumeLiters)
}

/** Did the returned fuel come back into the depot? New records say so with
 * `backToStock`; records from before that field carry it as the treatment. */
export const cameBackToStock = (s: Sale): boolean =>
  s.status === 'returned' && (s.resolution?.backToStock ?? s.resolution?.treatment === 'restocked')

/** Volume a return physically put back into the warehouse. Only a return whose
 * fuel came back counts - refunded, credited or replaced says what happened to
 * the money, not to the fuel, and a rejected load that was dumped is gone. */
export function restockedVolume(s: Sale): number {
  return cameBackToStock(s) ? returnedVolume(s) : 0
}

/**
 * SALES basis: volume this sale contributes to sales, revenue and quota.
 *
 * Net sales are sales less returns, full stop - the client's accounting, and
 * the ordinary one. A returned order comes off in full (or by the partial
 * volume) whether the money was refunded, credited, replaced or never
 * collected, and whether or not the fuel came back. Recognised on the sale
 * date once the order is confirmed against the client's PO, not when the
 * fuel leaves the depot - that is the stock side, below.
 *
 *   draft, cancelled     → 0, the sale never happened
 *   confirmed, fulfilled → the full order
 *   returned             → the order less what was returned
 */
export function netSaleVolume(s: Sale): number {
  if (s.status === 'returned') return Math.max(0, s.volumeLiters - returnedVolume(s))
  return saleCounts(s) ? s.volumeLiters : 0
}

/**
 * STOCK basis: volume this sale leaves out of the depot, net of what came
 * back. Differs from netSaleVolume on exactly one case - a return whose fuel
 * did not come back: it is off the sales figure, but the litres are still
 * gone from the tank. Inventory is not sales.
 */
export function stockSaleVolume(s: Sale): number {
  if (s.status === 'returned') return Math.max(0, s.volumeLiters - restockedVolume(s))
  return saleCounts(s) ? s.volumeLiters : 0
}

/**
 * Did this sale contribute any volume at all?
 *
 * Use this - not `saleCounts` - to decide whether a sale belongs in a volume,
 * revenue or quota figure. `saleCounts` answers a narrower question ("is the
 * status one that consumes stock"), and a RETURNED order fails it even when
 * part of the order was kept. Filtering on `saleCounts` and then summing
 * `netSaleVolume` looks right and silently drops every partial return, because
 * the filter removes the rows before netSaleVolume can credit the retained
 * portion.
 */
export const contributesVolume = (s: Sale) => netSaleVolume(s) > 0

export interface DateRange {
  from: string // ISO date inclusive
  to: string // ISO date inclusive
}

export function inRange(dateIso: string, range: DateRange) {
  const d = dateIso.slice(0, 10)
  return d >= range.from.slice(0, 10) && d <= range.to.slice(0, 10)
}

/** Stock on hand per warehouse: received purchases minus confirmed/fulfilled sales. All time. */
export function stockByWarehouse(purchases: Purchase[], sales: Sale[]): Map<string, number> {
  const stock = new Map<string, number>()
  for (const p of purchases) {
    if (p.status !== 'received') continue
    stock.set(p.warehouseId, (stock.get(p.warehouseId) ?? 0) + receivedVolume(p))
  }
  for (const s of sales) {
    const out = stockSaleVolume(s)
    if (!out) continue
    stock.set(s.warehouseId, (stock.get(s.warehouseId) ?? 0) - out)
  }
  return stock
}

/**
 * What a depot can still promise for a given day.
 *
 * Stock on hand already has every confirmed order taken off it, whenever
 * that order is due to leave. That is the right figure for "what is in the
 * tank that nobody has claimed", but the wrong one for an order booked for
 * next Tuesday, when the orders due on Wednesday and after have not gone
 * yet: those litres are still available to Tuesday's customer. So: stock on
 * hand, plus the confirmed-but-unfulfilled orders scheduled after the date.
 * Purchases on order are left out - they carry no arrival date, and a
 * promise against a tanker that has not landed is a pre-sale, which the form
 * asks to be authorised as such.
 */
export function stockOnDate(purchases: Purchase[], sales: Sale[], warehouseId: string, dateISO: string): {
  onHand: number
  /** Confirmed orders leaving after the date, whose litres are still there on it. */
  leavingLater: number
  available: number
} {
  const onHand = stockByWarehouse(purchases, sales).get(warehouseId) ?? 0
  const day = dateISO.slice(0, 10)
  let leavingLater = 0
  for (const s of sales) {
    if (s.warehouseId !== warehouseId || s.status !== 'confirmed') continue
    const when = (s.scheduleDate ?? s.date).slice(0, 10)
    if (when > day) leavingLater += s.volumeLiters
  }
  return { onHand, leavingLater, available: onHand + leavingLater }
}

/**
 * Stock on hand for one warehouse and one product.
 *
 * While MPower trades diesel only, every record has a blank productId, so this
 * agrees exactly with stockByWarehouse. It exists now rather than later because
 * the low supply warning (Secondary Feature 2.3) is specified "per product and
 * warehouse", and because writing it now means no read path has to change on the
 * day a second product is added.
 */
export function stockFor(
  purchases: Purchase[],
  sales: Sale[],
  warehouseId: string,
  productId?: string,
): number {
  const want = productKey(productId)
  let stock = 0
  for (const p of purchases) {
    if (p.status !== 'received' || p.warehouseId !== warehouseId) continue
    if (productKey(p.productId) !== want) continue
    stock += receivedVolume(p)
  }
  for (const s of sales) {
    if (s.warehouseId !== warehouseId || productKey(s.productId) !== want) continue
    stock -= stockSaleVolume(s)
  }
  return stock
}

/** Volume a purchase actually brought in. Exhibit A 1.2 asks for "volume
 * received per transaction" separately from what was ordered - a short or over
 * delivery is exactly the case where the two differ. Records that predate the
 * field fall back to the ordered volume. */
/**
 * The date a received purchase counts against.
 *
 * `receivedAt` when the receipt recorded one, otherwise the order date. Keep
 * every "volume in during this period" question going through this, so the
 * fallback is stated once rather than re-derived at each call site.
 */
export function purchaseInDate(p: Purchase): string {
  return p.receivedAt ?? p.date
}

/**
 * The volume a purchase is costed on.
 *
 * `receivedVolume` is zero until a load arrives, which is right for stock but
 * wrong for money: an ordered-but-undelivered purchase still has a price you
 * committed to. So this falls back to the ordered volume while a purchase is
 * open, and switches to what actually arrived once it has been received -
 * matching how `receiving.ts` re-spreads the installments.
 */
export function billedVolume(p: Purchase): number {
  return p.status === 'received' ? (p.volumeReceived ?? p.volumeLiters) : p.volumeLiters
}

/**
 * Weighted-average cost of a litre at a depot, across everything ever received
 * there. Null when nothing has been received - no rate, rather than a rate of
 * zero, which would value the tank at nothing.
 *
 * All-time on purpose. Stock on hand is an all-time figure, so valuing it at a
 * price averaged over the selected date range would divide one period's rate
 * into another period's volume - and a range containing no purchases at all
 * would have no rate to use while the tank was plainly full.
 *
 * This is weighted-average costing, not FIFO. For a fungible liquid in a shared
 * tank the two are close, but they are not the same number, and the UI says so
 * rather than presenting this as book value.
 */
export function avgUnitCost(purchases: Purchase[], warehouseId?: ID): number | null {
  let cost = 0
  let volume = 0
  for (const p of purchases) {
    if (p.status !== 'received') continue
    if (warehouseId !== undefined && p.warehouseId !== warehouseId) continue
    const v = receivedVolume(p)
    cost += v * p.pricePerLiter
    volume += v
  }
  return volume > 0 ? cost / volume : null
}

/** What the fuel standing in one depot cost to buy. Null when it cannot be priced. */
export function stockValue(purchases: Purchase[], sales: Sale[], warehouseId: ID): number | null {
  const rate = avgUnitCost(purchases, warehouseId)
  if (rate === null) return null
  return Math.max(stockFor(purchases, sales, warehouseId), 0) * rate
}

/**
 * The whole book's stock value: the sum of the depots, NOT total volume times a
 * global average. Those two differ whenever depots buy at different prices, and
 * a total that disagrees with the column above it is worse than no total.
 * Depots that cannot be priced are skipped, and the count of them is returned so
 * the UI can say the total is partial instead of quietly understating it.
 */
export function totalStockValue(purchases: Purchase[], sales: Sale[], warehouseIds: ID[]) {
  let total = 0
  let unpriced = 0
  for (const id of warehouseIds) {
    const v = stockValue(purchases, sales, id)
    if (v === null) unpriced++
    else total += v
  }
  return { total, unpriced, priced: warehouseIds.length - unpriced }
}

export function receivedVolume(p: Purchase): number {
  if (p.status !== 'received') return 0
  return p.volumeReceived ?? p.volumeLiters
}

/**
 * Every movement of fuel in or out, in one list - Exhibit A 1.2.
 *
 * The clause asks that volume out be "traced to the originating Sales or
 * Logistics record", and until now the Stock page could only show an aggregate:
 * you could see that 40,000 L left Valenzuela without being able to ask which
 * sales took it. This derives the ledger rather than storing one, so it cannot
 * drift from the purchases and sales it is built on - the same reason
 * `stockFor` recomputes instead of keeping a running balance.
 *
 * A returned-and-restocked sale produces a second, inbound movement rather than
 * quietly shrinking the original: the fuel genuinely left and genuinely came
 * back, and a ledger that nets them together loses the trip.
 */
export interface StockMovement {
  id: string
  /** When the fuel actually moved. */
  date: string
  direction: 'in' | 'out'
  /** Signed: positive into the depot, negative out of it. */
  liters: number
  warehouseId: ID
  productId?: ID
  /** The record this movement came from, for a deep link. */
  tbl: 'purchases' | 'sales'
  recordId: ID
  /** Supplier for a receipt, customer for a sale. Resolved by the caller. */
  counterpartyId?: ID
  kind: 'receipt' | 'sale' | 'return'
}

export function stockMovements(
  purchases: Purchase[],
  sales: Sale[],
  range?: DateRange,
): StockMovement[] {
  const out: StockMovement[] = []

  for (const p of purchases) {
    if (p.status !== 'received') continue
    const liters = receivedVolume(p)
    if (liters <= 0) continue
    out.push({
      id: `in-${p.id}`,
      date: purchaseInDate(p),
      direction: 'in',
      liters,
      warehouseId: p.warehouseId,
      productId: p.productId,
      tbl: 'purchases',
      recordId: p.id,
      counterpartyId: p.supplierId,
      kind: 'receipt',
    })
  }

  for (const s of sales) {
    const gone = stockSaleVolume(s) + restockedVolume(s)
    if (gone > 0) {
      out.push({
        id: `out-${s.id}`,
        date: s.date,
        direction: 'out',
        liters: -gone,
        warehouseId: s.warehouseId,
        productId: s.productId,
        tbl: 'sales',
        recordId: s.id,
        counterpartyId: s.customerId,
        kind: 'sale',
      })
    }
    const back = restockedVolume(s)
    if (back > 0) {
      out.push({
        id: `back-${s.id}`,
        date: s.date,
        direction: 'in',
        liters: back,
        warehouseId: s.warehouseId,
        productId: s.productId,
        tbl: 'sales',
        recordId: s.id,
        counterpartyId: s.customerId,
        kind: 'return',
      })
    }
  }

  return out
    .filter((m) => (range ? inRange(m.date, range) : true))
    .sort((a, b) => b.date.localeCompare(a.date))
}

/**
 * How many days of stock a depot has left at its recent rate of sale.
 *
 * The number a fuel distributor actually reorders against: 400,000 L means
 * nothing without knowing whether that is a fortnight or two days.
 *
 * Returns null rather than a number when nothing went out during the period.
 * A depot with no outflow has no rate to project from, and "infinite cover"
 * would be a claim rather than a measurement - a depot that simply had a quiet
 * month is not one that will never run dry.
 */
export function daysOfCover(
  purchases: Purchase[],
  sales: Sale[],
  warehouseId: ID,
  range: DateRange,
): number | null {
  const onHand = Math.max(stockFor(purchases, sales, warehouseId), 0)
  const { out } = warehouseFlow(purchases, sales, warehouseId, range)
  if (out <= 0) return null

  const from = Date.parse(range.from.slice(0, 10))
  const to = Date.parse(range.to.slice(0, 10))
  const days = Math.max(1, Math.round((to - from) / 86_400_000) + 1)
  const perDay = out / days
  if (perDay <= 0) return null
  return onHand / perDay
}

/** Volume in and out of one warehouse over a period - the "per warehouse" half
 * of 1.2, which the depot cards previously left out. */
export function warehouseFlow(
  purchases: Purchase[],
  sales: Sale[],
  warehouseId: ID,
  range: DateRange,
): { in: number; out: number; net: number } {
  let inLiters = 0
  let outLiters = 0
  for (const m of stockMovements(purchases, sales, range)) {
    if (m.warehouseId !== warehouseId) continue
    if (m.liters >= 0) inLiters += m.liters
    else outLiters += -m.liters
  }
  return { in: inLiters, out: outLiters, net: inLiters - outLiters }
}

export interface StockSeriesPoint {
  t: number
  /** Stock balance per warehouse id, at this point in time. */
  values: Record<string, number>
}

/** Running stock balance per warehouse, sampled at evenly spaced points across the range -
 * for a stock-level-over-time trend chart (stockByWarehouse only gives the current snapshot). */
export function stockSeries(
  purchases: Purchase[],
  sales: Sale[],
  warehouseIds: string[],
  range: DateRange,
  points = 20,
): StockSeriesPoint[] {
  const from = Date.parse(range.from)
  const to = Date.parse(range.to)
  const n = Math.max(2, points)
  const step = (to - from) / (n - 1)
  const series: StockSeriesPoint[] = []
  for (let i = 0; i < n; i++) {
    const t = Math.round(from + i * step)
    const cutoff = `${new Date(t).toISOString().slice(0, 10)}T23:59:59.999Z`
    const values: Record<string, number> = {}
    for (const id of warehouseIds) values[id] = 0
    for (const p of purchases) {
      if (p.status === 'received' && p.date <= cutoff && p.warehouseId in values) {
        values[p.warehouseId] += receivedVolume(p)
      }
    }
    for (const s of sales) {
      if (s.date <= cutoff && s.warehouseId in values) {
        values[s.warehouseId] -= stockSaleVolume(s)
      }
    }
    series.push({ t, values })
  }
  return series
}

export interface FlowPoint {
  t: number
  bought: number
  sold: number
}

/** Buckets received-purchase volume against sold volume per day (up to 16 buckets) across the
 * range - a build-up-vs-draw-down comparison, distinct from the running stockSeries balance. */
export function flowSeries(purchases: Purchase[], sales: Sale[], range: DateRange): FlowPoint[] {
  const from = Date.parse(range.from.slice(0, 10))
  const to = Date.parse(range.to.slice(0, 10))
  const days = Math.max(1, Math.round((to - from) / 86_400_000) + 1)
  const buckets = Math.min(days, 16)
  const per = days / buckets
  const bought = new Array(buckets).fill(0)
  const sold = new Array(buckets).fill(0)
  const bucketOf = (dateIso: string) => {
    const day = Math.round((Date.parse(dateIso.slice(0, 10)) - from) / 86_400_000)
    return Math.min(Math.max(Math.floor(day / per), 0), buckets - 1)
  }
  for (const p of purchases) {
    if (p.status !== 'received' || !inRange(p.date, range)) continue
    bought[bucketOf(p.date)] += receivedVolume(p)
  }
  for (const s of sales) {
    if (!inRange(s.date, range)) continue
    sold[bucketOf(s.date)] += stockSaleVolume(s)
  }
  return bought.map((b, i) => ({
    t: Math.round(from + (i / (buckets - 1 || 1)) * (to - from)),
    bought: b,
    sold: sold[i],
  }))
}

export type ActivityKind = 'purchase' | 'sale' | 'delivery'

export interface ActivityEvent {
  id: string
  t: number
  kind: ActivityKind
}

/** Most recent purchases, non-draft sales, and deliveries combined into one feed, newest
 * first. Callers resolve display text by looking `id` back up in their own record lists. */
export function recentActivity(purchases: Purchase[], sales: Sale[], deliveries: Delivery[], limit = 8): ActivityEvent[] {
  const events: ActivityEvent[] = [
    ...purchases.map((p): ActivityEvent => ({ id: p.id, t: Date.parse(p.date), kind: 'purchase' })),
    ...sales.filter((s) => s.status !== 'draft').map((s): ActivityEvent => ({ id: s.id, t: Date.parse(s.date), kind: 'sale' })),
    ...deliveries.map((d): ActivityEvent => ({ id: d.id, t: Date.parse(d.scheduleDate), kind: 'delivery' })),
  ]
  return events.sort((a, b) => b.t - a.t).slice(0, limit)
}

export function volumeIn(purchases: Purchase[], range: DateRange) {
  return purchases
    .filter((p) => p.status === 'received' && inRange(purchaseInDate(p), range))
    .reduce((sum, p) => sum + receivedVolume(p), 0)
}

export function volumeOut(sales: Sale[], range: DateRange) {
  return sales
    .filter((s) => inRange(s.date, range))
    .reduce((sum, s) => sum + netSaleVolume(s), 0)
}

export function revenue(sales: Sale[], range: DateRange) {
  return sales
    .filter((s) => inRange(s.date, range))
    .reduce((sum, s) => sum + netSaleVolume(s) * s.pricePerLiter, 0)
}

/** "Overdue" isn't a stored status - it's a still-pending installment (sale or purchase side,
 * both share the same {status, dueDate} shape) whose due date has already passed. Collected/
 * paid/cancelled installments are never overdue. */
export function isInstallmentOverdue(i: { status: string; dueDate: string }): boolean {
  // A bounced post-dated check is not "overdue" - it is its own failure state,
  // reported separately, so it isn't double-counted in the overdue figures.
  return i.status === 'pending' && Date.parse(i.dueDate) < Date.now()
}

export interface SaleInstallmentEntry {
  sale: Sale
  installment: SaleInstallment
}

/** Every installment across every non-draft sale, paired with its parent sale so callers can
 * still get at the customer, volume, etc. A plain single-installment sale just yields one entry. */
export function saleInstallmentEntries(sales: Sale[]): SaleInstallmentEntry[] {
  return sales
    // Drafts have nothing to collect yet, and a cancelled order has nothing to
    // collect any more. A returned order keeps its installments: whether the
    // money still moves depends on the treatment (a credit note or replacement
    // leaves the receivable standing; a refund is settled separately).
    .filter((s) => s.status !== 'draft' && s.status !== 'cancelled')
    .flatMap((s) => s.installments.map((installment) => ({ sale: s, installment })))
}

export interface PurchaseInstallmentEntry {
  purchase: Purchase
  installment: PurchaseInstallment
}

/** Same idea, for purchases (no draft-equivalent status to exclude). */
export function purchaseInstallmentEntries(purchases: Purchase[]): PurchaseInstallmentEntry[] {
  return purchases.flatMap((p) => p.installments.map((installment) => ({ purchase: p, installment })))
}

export interface AgentStat {
  agent: Agent
  /** Net litres sold in the range - cancellations and returns taken off. */
  volume: number
  /** Those same litres at the price each was sold at. */
  revenue: number
  /**
   * The agent's monthly quota, prorated to the length of the range (min 1
   * month's worth), in litres.
   *
   * Carried on the stat because the percentage beside it is unreadable
   * without it: quotas here run from 40,000 to 60,000 L, so the same 62% is
   * different work for different people, and over a 7-day range it isn't the
   * monthly quota being measured against at all.
   */
  quota: number
  /** volume ÷ quota. Zero when the agent has no quota set. */
  quotaProgress: number
  rank: number
}

/** Re-exported from src/lib/credit.ts, which owns the credit derivations
 * (Exhibit A 1.4). Kept here so the many existing importers don't move. */
export type { CreditRating } from './credit'

export interface CustomerStat {
  customer: Customer
  orderCount: number
  avgOrderLiters: number
  /** Average days between orders; null with fewer than 2 orders. */
  reorderDays: number | null
  avgPrice: number
  /** avgPrice minus avgBuyCost passed in. Null when either side is unknown. */
  markup: number | null
  usualPayment: Sale['paymentMode'] | null
  yearsWith: number | null
  netVolume: number
  netAmount: number
  onTimeRate: number | null
  overdueCount: number
  overdueAmount: number
  rating: CreditRating | null
  /** Full credit derivation - ease of collection, punctuality, and the counts
   * behind them (Exhibit A 1.4). */
  history: CreditHistory
}

/** Aggregates each customer's full sales history; net volume/amount are scoped to the range. */
export function customerStats(
  customers: Customer[],
  sales: Sale[],
  range: DateRange,
  avgBuyCost: number | null,
): CustomerStat[] {
  return customers.map((customer) => {
    const own = sales
      .filter((s) => s.customerId === customer.id && contributesVolume(s))
      .sort((a, b) => a.date.localeCompare(b.date))
    const orderCount = own.length
    // Net of returns, per Exhibit A 1.4 "net order volume" - an order the
    // customer sent back should not inflate their average order size.
    const totalVol = own.reduce((sum, s) => sum + netSaleVolume(s), 0)
    const totalAmt = own.reduce((sum, s) => sum + netSaleVolume(s) * s.pricePerLiter, 0)
    const avgOrderLiters = orderCount > 0 ? totalVol / orderCount : 0
    const avgPrice = totalVol > 0 ? totalAmt / totalVol : 0

    let reorderDays: number | null = null
    if (orderCount >= 2) {
      const span = Date.parse(own[own.length - 1].date) - Date.parse(own[0].date)
      reorderDays = Math.round(span / 86_400_000 / (orderCount - 1))
    }

    const modes = new Map<Sale['paymentMode'], number>()
    for (const s of own) modes.set(s.paymentMode, (modes.get(s.paymentMode) ?? 0) + 1)
    const usualPayment = [...modes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

    const yearsWith = customer.customerSince
      ? Math.max(0, (Date.now() - Date.parse(customer.customerSince)) / (365.25 * 86_400_000))
      : null

    // "Net order volume within a user-selected date interval" (Exhibit A 1.4) -
    // net means net of returns, so this reads netSaleVolume rather than the
    // order size. A partially returned order counts for the part that stuck.
    const inR = own.filter((s) => inRange(s.date, range))
    const netVolume = inR.reduce((sum, s) => sum + netSaleVolume(s), 0)
    const netAmount = inR.reduce((sum, s) => sum + netSaleVolume(s) * s.pricePerLiter, 0)

    // Credit history lives in src/lib/credit.ts so ease of collection,
    // punctuality and the rating have one implementation - the Accounts drawer
    // and this summary must never disagree about whether an account pays well.
    // Note it reads EVERY sale of the customer's, not just the ones that
    // contributed volume: a cancelled order's installments are excluded inside
    // creditHistory, but a returned order's payment behaviour still counts.
    const history = creditHistory(customerInstallments(customer.id, sales))

    return {
      customer, orderCount, avgOrderLiters, reorderDays, avgPrice,
      markup: avgBuyCost !== null && avgPrice > 0 ? avgPrice - avgBuyCost : null,
      usualPayment, yearsWith, netVolume, netAmount,
      onTimeRate: history.onTimeRate,
      overdueCount: history.openOverdue,
      overdueAmount: history.overdueAmount,
      rating: history.rating,
      history,
    }
  })
}

export interface SupplierStat {
  supplier: Supplier
  totalSpend: number
  totalVolume: number
  purchaseCount: number
  share: number
  avgPaid: number | null
  avgQuoted: number | null
  lastQuote: SupplierQuote | null
  rank: number
}

/** Ranks suppliers by spend within the range; quote aggregates cover the same range. */
export function supplierStats(
  suppliers: Supplier[],
  purchases: Purchase[],
  quotes: SupplierQuote[],
  range: DateRange,
): SupplierStat[] {
  const stats = suppliers.map((supplier) => {
    // Only 'received' purchases count toward spend/volume/avg paid - matches the price
    // chart (which only plots received purchases) and stockByWarehouse. An 'ordered'
    // purchase hasn't actually cost anything yet, so counting it here made a supplier's
    // table row disagree with its chart: spend already showing, no dot yet to back it up.
    const own = purchases.filter((p) => p.supplierId === supplier.id && p.status === 'received' && inRange(purchaseInDate(p), range))
    const totalSpend = own.reduce((sum, p) => sum + p.volumeLiters * p.pricePerLiter, 0)
    const totalVolume = own.reduce((sum, p) => sum + p.volumeLiters, 0)
    const ownQuotes = quotes.filter((q) => q.supplierId === supplier.id)
    const inRangeQuotes = ownQuotes.filter((q) => inRange(q.date, range))
    const lastQuote = ownQuotes.sort((a, b) => b.date.localeCompare(a.date))[0] ?? null
    return {
      supplier,
      totalSpend,
      totalVolume,
      purchaseCount: own.length,
      share: 0,
      avgPaid: totalVolume > 0 ? totalSpend / totalVolume : null,
      avgQuoted: inRangeQuotes.length > 0
        ? inRangeQuotes.reduce((sum, q) => sum + q.pricePerLiter, 0) / inRangeQuotes.length
        : null,
      lastQuote,
      rank: 0,
    }
  })
  const grand = stats.reduce((sum, s) => sum + s.totalSpend, 0)
  stats.sort((a, b) => b.totalSpend - a.totalSpend)
  stats.forEach((s, i) => {
    s.rank = i + 1
    s.share = grand > 0 ? s.totalSpend / grand : 0
  })
  return stats
}

export function agentStats(agents: Agent[], sales: Sale[], range: DateRange): AgentStat[] {
  const days = Math.max(
    1,
    Math.round((Date.parse(range.to) - Date.parse(range.from)) / 86_400_000) + 1,
  )
  const months = Math.max(days / 30, 1 / 30)
  const stats = agents.map((agent) => {
    // Quota is credited on volume that actually stuck: a cancelled order earns
    // nothing, and a returned one earns only the part not sent back.
    const own = sales.filter((s) => s.agentId === agent.id && contributesVolume(s) && inRange(s.date, range))
    const volume = own.reduce((sum, s) => sum + netSaleVolume(s), 0)
    const rev = own.reduce((sum, s) => sum + netSaleVolume(s) * s.pricePerLiter, 0)
    const quota = agent.monthlyQuotaLiters * months
    return { agent, volume, revenue: rev, quota, quotaProgress: quota > 0 ? volume / quota : 0, rank: 0 }
  })
  stats.sort((a, b) => b.volume - a.volume)
  stats.forEach((s, i) => {
    s.rank = i + 1
  })
  return stats
}

// ---- Collection -------------------------------------------------------------

/** Person in charge of collecting an installment: its own collectorId, else the sale's
 * default. Null when neither is set ("Unassigned"). */
export function installmentCollector(sale: Sale, inst: SaleInstallment): string | null {
  return inst.collectorId ?? sale.collectorId ?? null
}

/** Receiving bank account for an installment: its own override, else the sale's. */
export function installmentBankAccount(sale: Sale, inst: SaleInstallment): string | null {
  return inst.bankAccountId ?? sale.bankAccountId ?? null
}

/**
 * The collector's work queue: money nobody has gone and got yet.
 *
 * Deliberately narrower than "what the customer still owes". Once a check is
 * in the collector's hands their part is done, so it leaves this queue - but it
 * is not paid, and `unsettledReceivables` below is what the account's balance
 * is built from. Keeping the two apart is what stops the queue nagging a
 * collector about a check already sitting in the office safe.
 */
export function openReceivables(sales: Sale[]): SaleInstallmentEntry[] {
  return saleInstallmentEntries(sales).filter((e) => e.installment.status === 'pending')
}

/**
 * What the customer still actually owes: everything not yet cleared.
 *
 * A check in hand and a check in clearing are both money the bank has not paid
 * out, and either can still be refused, so both stay on the balance. The
 * happy consequence is that a bounce needs no reversal anywhere - the amount
 * was never taken off what was owed in the first place.
 */
export function unsettledReceivables(sales: Sale[]): SaleInstallmentEntry[] {
  return saleInstallmentEntries(sales).filter((e) => isOutstanding(e.installment.status))
}

/**
 * The treasury's deposit queue: paper in somebody's hands, not yet banked.
 *
 * Ordered by when each item became bankable rather than by when it arrived - a
 * post-dated check collected three weeks early cannot be deposited until the
 * date written on it, so sorting by collection date would put items at the top
 * that the bank would simply refuse. `depositDue` is that date: the check's
 * own, or the day it was received when there is no check.
 */
export function undepositedItems(sales: Sale[]): Array<SaleInstallmentEntry & { depositDue: string }> {
  return saleInstallmentEntries(sales)
    .filter((e) => isInHand(e.installment.status))
    .map((e) => ({
      ...e,
      depositDue: e.installment.checkDate ?? e.installment.collectedAt ?? e.installment.dueDate,
    }))
    .sort((a, b) => a.depositDue.localeCompare(b.depositDue))
}

/** Banked and waiting on the bank to say yes or no. */
/**
 * Everything that has been banked, newest first: in clearing, cleared, or
 * bounced. The Deposits page's history - "did we bank that check, when, and
 * what did the bank say" - which had no screen: a deposit left the queue and
 * was only findable inside its sale.
 */
export function depositedItems(sales: Sale[]): SaleInstallmentEntry[] {
  return saleInstallmentEntries(sales)
    .filter((e) => !!e.installment.depositedAt && (isInClearing(e.installment.status) || e.installment.status === 'cleared' || e.installment.status === 'bounced'))
    .sort((a, b) => (b.installment.depositedAt ?? '').localeCompare(a.installment.depositedAt ?? ''))
}

export function itemsInClearing(sales: Sale[]): SaleInstallmentEntry[] {
  return saleInstallmentEntries(sales)
    .filter((e) => isInClearing(e.installment.status))
    .sort((a, b) => (a.installment.depositedAt ?? '').localeCompare(b.installment.depositedAt ?? ''))
}

/**
 * A deposit that is late: the check could have been banked and wasn't.
 *
 * The number worth watching in this whole change. Cash or a matured check
 * sitting undeposited is the one position where the company's money is in a
 * single person's custody with no bank record of it.
 */
export function depositOverdue(depositDue: string, asOf = Date.now()): boolean {
  return Date.parse(depositDue) < asOf
}

export const AGING_BUCKETS = ['current', '1-30', '31-60', '61-90', '90+'] as const
export type AgingBucket = typeof AGING_BUCKETS[number]

/** Standard AR aging: not-yet-due is 'current'; otherwise bucketed by whole days past due
 * (due yesterday = 1 day). `today` is an ISO date, defaulting to the real today. */
export function agingBucketOf(dueDate: string, today = new Date().toISOString()): AgingBucket {
  const days = Math.floor(
    (Date.parse(today.slice(0, 10)) - Date.parse(dueDate.slice(0, 10))) / 86_400_000,
  )
  if (days <= 0) return 'current'
  if (days <= 30) return '1-30'
  if (days <= 60) return '31-60'
  if (days <= 90) return '61-90'
  return '90+'
}

export interface CustomerBalance {
  customerId: string
  /** Everything not yet cleared: still to collect, plus in hand or at the bank. */
  outstanding: number
  /**
   * Collected but not yet money: in a collector's hands or at the bank. Part
   * of `outstanding`, and outside the ageing buckets, because a check sitting
   * in clearing is not late - it is just not paid yet.
   */
  inFlight: number
  overdue: number
  /** Outstanding amount per aging bucket - buckets sum to `outstanding`. */
  aging: Record<AgingBucket, number>
  /** Earliest due date among open installments. */
  nextDue: string | null
  openCount: number
  /** Distinct resolved collector ids across open installments (null = unassigned excluded). */
  collectorIds: string[]
}

/** Per-customer balances from everything not yet cleared, sorted by outstanding descending.
 * Customers owing nothing are omitted. "Overdue" here is bucket-based (whole days past due,
 * so due-today counts as current) - the day-granular cousin of isInstallmentOverdue, injectable
 * with a fixed `today` so reports and tests are deterministic. */
export function outstandingByCustomer(sales: Sale[], today = new Date().toISOString()): CustomerBalance[] {
  const byCustomer = new Map<string, CustomerBalance>()
  for (const { sale, installment } of unsettledReceivables(sales)) {
    let b = byCustomer.get(sale.customerId)
    if (!b) {
      b = {
        customerId: sale.customerId, outstanding: 0, inFlight: 0, overdue: 0,
        aging: { 'current': 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0 },
        nextDue: null, openCount: 0, collectorIds: [],
      }
      byCustomer.set(sale.customerId, b)
    }
    b.outstanding += installment.amount
    // Collected but not cleared: on the balance, not in the ageing. It has
    // been collected, so it is neither open nor late.
    if (installment.status !== 'pending') {
      b.inFlight += installment.amount
      continue
    }
    b.openCount += 1
    const bucket = agingBucketOf(installment.dueDate, today)
    b.aging[bucket] += installment.amount
    if (bucket !== 'current') b.overdue += installment.amount
    if (!b.nextDue || installment.dueDate < b.nextDue) b.nextDue = installment.dueDate
    const collector = installmentCollector(sale, installment)
    if (collector && !b.collectorIds.includes(collector)) b.collectorIds.push(collector)
  }
  return [...byCustomer.values()].sort((a, b) => b.outstanding - a.outstanding)
}

export interface CollectorLoad {
  /** Personnel id, or null for the "Unassigned" group. */
  collectorId: string | null
  openCount: number
  amount: number
  overdueAmount: number
}

/** Open receivables grouped by resolved person in charge, biggest load first; installments
 * with no collector at either level group under collectorId null ("Unassigned"). */
export function collectorWorkload(sales: Sale[], today = new Date().toISOString()): CollectorLoad[] {
  const byCollector = new Map<string | null, CollectorLoad>()
  for (const { sale, installment } of openReceivables(sales)) {
    const id = installmentCollector(sale, installment)
    let load = byCollector.get(id)
    if (!load) {
      load = { collectorId: id, openCount: 0, amount: 0, overdueAmount: 0 }
      byCollector.set(id, load)
    }
    load.openCount += 1
    load.amount += installment.amount
    if (agingBucketOf(installment.dueDate, today) !== 'current') load.overdueAmount += installment.amount
  }
  return [...byCollector.values()].sort((a, b) => b.amount - a.amount)
}

// ---- Depot ledger: moving-average cost, sources, trailing cover, utilization --

/**
 * What the ledger walk knows about one depot at a point in time.
 *
 * `avgCost` is the moving-average cost of the litres now in the tank: every
 * receipt re-averages its price into what was in the tank at that moment, and
 * a sale takes litres out at that average without changing it. The weights
 * are litres, nothing else - no time value, no interest on the earlier loads.
 * This replaces the all-time average of every receipt, which kept counting
 * litres long since sold: after a cheap month and an expensive one, the tank
 * holding only the expensive fuel was still valued at the blend.
 *
 * `sources` is where the litres in the tank came from, by supplier, on the
 * same mixing model: a sale draws from every supplier's litres in proportion
 * to their share of the tank, because in a shared tank there is no other
 * honest answer. A return goes back in at the depot's current average and is
 * attributed to the mix as it stands.
 */
export interface DepotLedger {
  onHand: number
  /** Null until the depot has received anything. */
  avgCost: number | null
  /** onHand × avgCost; null when avgCost is. */
  value: number | null
  /** Litres in the tank by supplier id. Sums to onHand. */
  sources: Record<ID, number>
  /** ISO date of the depot's first movement, for windows that must not reach before it. */
  firstMovement: string | null
}

export function depotLedger(
  purchases: Purchase[],
  sales: Sale[],
  warehouseId: ID,
  asOf?: string,
): DepotLedger {
  const cutoff = asOf ? `${asOf.slice(0, 10)}T23:59:59.999Z` : undefined
  const moves = stockMovements(purchases, sales)
    .filter((m) => m.warehouseId === warehouseId && (!cutoff || m.date <= cutoff))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.direction === 'in' ? -1 : 1))
  const priceOf = new Map(purchases.map((p) => [p.id, p.pricePerLiter]))

  let onHand = 0
  let avgCost: number | null = null
  const sources: Record<ID, number> = {}
  const firstMovement = moves[0]?.date ?? null

  for (const m of moves) {
    if (m.liters > 0) {
      const price: number = m.kind === 'receipt' ? (priceOf.get(m.recordId) ?? 0) : (avgCost ?? 0)
      const had = Math.max(onHand, 0)
      avgCost = had + m.liters > 0 ? ((avgCost ?? 0) * had + price * m.liters) / (had + m.liters) : price
      if (m.kind === 'receipt' && m.counterpartyId) {
        sources[m.counterpartyId] = (sources[m.counterpartyId] ?? 0) + m.liters
      } else {
        // A return: back into the mix as it stands, or to "unknown" for an empty tank.
        const total = Object.values(sources).reduce((a, b) => a + b, 0)
        if (total > 0) for (const k of Object.keys(sources)) sources[k] += m.liters * (sources[k] / total)
        else sources['?'] = (sources['?'] ?? 0) + m.liters
      }
      onHand = had + m.liters
    } else {
      const gone = Math.min(-m.liters, Math.max(onHand, 0))
      const total = Object.values(sources).reduce((a, b) => a + b, 0)
      if (total > 0) for (const k of Object.keys(sources)) sources[k] -= gone * (sources[k] / total)
      onHand = Math.max(onHand, 0) - gone
    }
  }
  for (const k of Object.keys(sources)) if (sources[k] < 0.5) delete sources[k]
  return {
    onHand,
    avgCost,
    value: avgCost === null ? null : Math.max(onHand, 0) * avgCost,
    sources,
    firstMovement,
  }
}

/** Every depot's ledger added up: value is the sum of the depots, sources the
 *  sum of their litres, with a count of depots that could not be priced. */
export function totalLedger(purchases: Purchase[], sales: Sale[], warehouseIds: ID[], asOf?: string) {
  let value = 0
  let unpriced = 0
  let onHand = 0
  const sources: Record<ID, number> = {}
  for (const id of warehouseIds) {
    const l = depotLedger(purchases, sales, id, asOf)
    onHand += Math.max(l.onHand, 0)
    if (l.value === null) unpriced++
    else value += l.value
    for (const [k, v] of Object.entries(l.sources)) sources[k] = (sources[k] ?? 0) + v
  }
  return { value, onHand, sources, unpriced, priced: warehouseIds.length - unpriced }
}

/**
 * Days of cover from the last `days` days of actual sales - a fixed window
 * ending today, independent of the date range picker.
 *
 * The range-based projection could be flattered two ways: a range reaching
 * into the future divided the outflow over days that had not happened, and one
 * reaching back before the depot traded divided it over days it could not
 * have sold. This clips the window at the depot's first movement, and does not
 * move when the picker does. Null when nothing went out in the window, as
 * before: a quiet month is not proof a depot will never run dry.
 */
export function daysOfCoverTrailing(
  purchases: Purchase[],
  sales: Sale[],
  warehouseId: ID,
  days = 30,
  now = new Date(),
): { days: number | null; windowDays: number; perDay: number } {
  const ledger = depotLedger(purchases, sales, warehouseId)
  const onHand = Math.max(ledger.onHand, 0)
  const end = now.toISOString().slice(0, 10)
  let start = new Date(now.getTime() - (days - 1) * 86_400_000).toISOString().slice(0, 10)
  if (ledger.firstMovement && ledger.firstMovement.slice(0, 10) > start) start = ledger.firstMovement.slice(0, 10)
  const windowDays = Math.max(1, Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1)
  const { out } = warehouseFlow(purchases, sales, warehouseId, { from: start, to: end })
  const perDay = out / windowDays
  return { days: perDay > 0 ? onHand / perDay : null, windowDays, perDay }
}

/**
 * How much of a depot's capacity was in use across the range: the average of
 * the sampled fill levels, with the peak and the low. A level over time says
 * what happened; this says whether the tank is earning its size. Null when
 * the depot has no capacity recorded. Fill is capped at full: a balance above
 * capacity is a recording problem (the receive dialog warns of it), and a
 * "191% utilized" tank reads as a bug rather than a fact.
 */
export function utilization(
  series: StockSeriesPoint[],
  warehouseId: ID,
  capacityLiters: number,
): { avg: number; peak: number; low: number } | null {
  if (capacityLiters <= 0 || series.length === 0) return null
  const fills = series.map((p) => Math.min(Math.max(p.values[warehouseId] ?? 0, 0) / capacityLiters, 1))
  return {
    avg: fills.reduce((a, b) => a + b, 0) / fills.length,
    peak: Math.max(...fills),
    low: Math.min(...fills),
  }
}

/* ------------------------------------------------------------------------ */
/* Sales over time                                                           */
/* ------------------------------------------------------------------------ */

export type TrendGrain = 'day' | 'week' | 'month' | 'quarter'

export interface TrendPoint {
  /** Bucket start, ms. */
  t: number
  /** ISO dates the bucket covers, clipped to the range. */
  from: string
  to: string
  label: string
  liters: number
  revenue: number
}

/**
 * The grain a range reads best at: a week per day, a month per week, a year
 * per month, longer per quarter. The user can override it on the card.
 */
export function trendGrainFor(range: DateRange): TrendGrain {
  const days = Math.round((Date.parse(range.to.slice(0, 10)) - Date.parse(range.from.slice(0, 10))) / 86_400_000) + 1
  if (days <= 15) return 'day'
  if (days <= 35) return 'week'
  if (days <= 400) return 'month'
  return 'quarter'
}

const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10)

/** Bucket boundaries covering the range. Weeks are 7-day windows counted from
 * the start of the range (so "last 30 days" is four full weeks and a stub);
 * months and quarters are calendar ones, clipped at both ends. */
function trendBuckets(range: DateRange, grain: TrendGrain): { from: string; to: string; t: number; label: string }[] {
  const from = Date.parse(range.from.slice(0, 10))
  const to = Date.parse(range.to.slice(0, 10))
  const out: { from: string; to: string; t: number; label: string }[] = []
  const fmt = (t: number, opts: Intl.DateTimeFormatOptions) => new Date(t).toLocaleDateString('en-PH', { timeZone: 'UTC', ...opts })
  if (grain === 'day') {
    for (let t = from; t <= to; t += 86_400_000) out.push({ from: isoDay(t), to: isoDay(t), t, label: fmt(t, { month: 'short', day: 'numeric' }) })
  } else if (grain === 'week') {
    for (let t = from; t <= to; t += 7 * 86_400_000) {
      const end = Math.min(t + 6 * 86_400_000, to)
      out.push({ from: isoDay(t), to: isoDay(end), t, label: `${fmt(t, { month: 'short', day: 'numeric' })}–${fmt(end, { day: 'numeric' })}` })
    }
  } else {
    const d = new Date(from)
    const step = grain === 'month' ? 1 : 3
    let y = d.getUTCFullYear()
    let m = grain === 'month' ? d.getUTCMonth() : Math.floor(d.getUTCMonth() / 3) * 3
    while (Date.UTC(y, m, 1) <= to) {
      const start = Math.max(Date.UTC(y, m, 1), from)
      const end = Math.min(Date.UTC(y, m + step, 0), to)
      out.push({
        from: isoDay(start), to: isoDay(end), t: start,
        label: grain === 'month' ? fmt(Date.UTC(y, m, 1), { month: 'short', year: '2-digit' }) : `Q${m / 3 + 1} ${String(y).slice(2)}`,
      })
      m += step
      if (m >= 12) { m -= 12; y += 1 }
    }
  }
  return out
}

/** Net sales per bucket across the range, on the sales basis (netSaleVolume):
 * confirmed on the client's PO, returns netted off. */
export function salesTrend(sales: Sale[], range: DateRange, grain: TrendGrain): TrendPoint[] {
  const buckets = trendBuckets(range, grain).map((b) => ({ ...b, liters: 0, revenue: 0 }))
  for (const s of sales) {
    const day = s.date.slice(0, 10)
    const b = buckets.find((x) => day >= x.from && day <= x.to)
    if (!b) continue
    const v = netSaleVolume(s)
    b.liters += v
    b.revenue += v * s.pricePerLiter
  }
  return buckets
}
