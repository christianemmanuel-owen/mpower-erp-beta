import { describe, expect, it } from 'vitest'
import { netSaleVolume, receivedVolume, restockedVolume, stockFor, stockSaleVolume } from './metrics'
import type { Purchase, Sale } from '../data/types'

/**
 * The client half of the drift guard - see the header of server/stock.test.ts.
 *
 * The same cases, run against the implementations in src/lib/metrics.ts that
 * every on-screen stock figure uses. The low supply warning (2.3) is evaluated
 * server-side against server/stock.ts; if these two ever disagree, the warning
 * fires on a number the user cannot see anywhere in the app.
 *
 * If you change a rule, change it in both files and update BOTH case tables.
 */
const SALE_CASES: { name: string; sale: Partial<Sale>; expected: number }[] = [
  { name: 'draft consumes nothing', sale: { status: 'draft', volumeLiters: 1000 }, expected: 0 },
  { name: 'confirmed consumes the order', sale: { status: 'confirmed', volumeLiters: 1000 }, expected: 1000 },
  { name: 'fulfilled consumes the order', sale: { status: 'fulfilled', volumeLiters: 1000 }, expected: 1000 },
  { name: 'cancelled consumes nothing', sale: { status: 'cancelled', volumeLiters: 1000 }, expected: 0 },
  {
    name: 'return restocked in full consumes nothing',
    sale: { status: 'returned', volumeLiters: 1000, resolution: { date: '2026-08-01', reason: 'off-spec', treatment: 'restocked' } },
    expected: 0,
  },
  {
    name: 'partial return consumes the part that stuck',
    sale: { status: 'returned', volumeLiters: 1000, resolution: { date: '2026-08-01', reason: 'short order', treatment: 'restocked', volumeReturned: 300 } },
    expected: 700,
  },
  {
    name: 'refunded return still consumed the fuel',
    sale: { status: 'returned', volumeLiters: 1000, resolution: { date: '2026-08-01', reason: 'dispute', treatment: 'refunded' } },
    expected: 1000,
  },
  {
    name: 'written-off return still consumed the fuel',
    sale: { status: 'returned', volumeLiters: 1000, resolution: { date: '2026-08-01', reason: 'spillage', treatment: 'written_off', volumeReturned: 400 } },
    expected: 1000,
  },
  {
    name: 'over-large volumeReturned cannot create stock',
    sale: { status: 'returned', volumeLiters: 1000, resolution: { date: '2026-08-01', reason: 'typo', treatment: 'restocked', volumeReturned: 5000 } },
    expected: 0,
  },
  {
    name: 'refunded return whose fuel came back (new records) consumes nothing',
    sale: { status: 'returned', volumeLiters: 1000, resolution: { date: '2026-08-01', reason: 'dispute', treatment: 'refunded', backToStock: true } },
    expected: 0,
  },
  {
    name: 'return whose fuel did not come back is still out of the tank',
    sale: { status: 'returned', volumeLiters: 1000, resolution: { date: '2026-08-01', reason: 'dumped', treatment: 'credit_note', backToStock: false, volumeReturned: 400 } },
    expected: 1000,
  },
]

/**
 * The SALES basis is a different table: a return comes off net sales whatever
 * happened to the fuel or the money - net sales are sales less returns, the
 * client's accounting. Inventory is not sales.
 */
const NET_SALES_CASES: { name: string; sale: Partial<Sale>; expected: number }[] = [
  { name: 'confirmed counts in full - recognised on the client PO, not on dispatch', sale: { status: 'confirmed', volumeLiters: 1000 }, expected: 1000 },
  { name: 'cancelled counts nothing', sale: { status: 'cancelled', volumeLiters: 1000 }, expected: 0 },
  {
    name: 'a full return comes off in full even when the fuel never came back',
    sale: { status: 'returned', volumeLiters: 1000, resolution: { date: '2026-08-01', reason: 'dumped', treatment: 'refunded', backToStock: false } },
    expected: 0,
  },
  {
    name: 'a credit-note return comes off in full',
    sale: { status: 'returned', volumeLiters: 1000, resolution: { date: '2026-08-01', reason: 'dispute', treatment: 'credit_note', backToStock: true } },
    expected: 0,
  },
  {
    name: 'a partial return comes off by the returned volume',
    sale: { status: 'returned', volumeLiters: 1000, resolution: { date: '2026-08-01', reason: 'short', treatment: 'no_action', backToStock: false, volumeReturned: 300 } },
    expected: 700,
  },
  {
    name: 'a legacy written-off return still comes off sales',
    sale: { status: 'returned', volumeLiters: 1000, resolution: { date: '2026-08-01', reason: 'spillage', treatment: 'written_off' } },
    expected: 0,
  },
]

const PURCHASE_CASES: { name: string; purchase: Partial<Purchase>; expected: number }[] = [
  { name: 'ordered but not received brings in nothing', purchase: { status: 'ordered', volumeLiters: 5000 }, expected: 0 },
  { name: 'received with no explicit receipt uses the order', purchase: { status: 'received', volumeLiters: 5000 }, expected: 5000 },
  { name: 'short delivery counts what arrived', purchase: { status: 'received', volumeLiters: 5000, volumeReceived: 4800 }, expected: 4800 },
  { name: 'over delivery counts what arrived', purchase: { status: 'received', volumeLiters: 5000, volumeReceived: 5200 }, expected: 5200 },
]

describe('client stock rules', () => {
  it.each(SALE_CASES)('stockSaleVolume: $name', ({ sale, expected }) => {
    expect(stockSaleVolume(sale as Sale)).toBe(expected)
  })

  it.each(NET_SALES_CASES)('netSaleVolume: $name', ({ sale, expected }) => {
    expect(netSaleVolume(sale as Sale)).toBe(expected)
  })

  it.each(PURCHASE_CASES)('receivedVolume: $name', ({ purchase, expected }) => {
    expect(receivedVolume(purchase as Purchase)).toBe(expected)
  })

  it('only counts a restock when the fuel came back', () => {
    const base = { status: 'returned', volumeLiters: 100 } as Partial<Sale>
    expect(restockedVolume({ ...base, resolution: { date: 'x', reason: 'y', treatment: 'restocked' } } as Sale)).toBe(100)
    expect(restockedVolume({ ...base, resolution: { date: 'x', reason: 'y', treatment: 'refunded' } } as Sale)).toBe(0)
    expect(restockedVolume({ ...base, resolution: { date: 'x', reason: 'y', treatment: 'refunded', backToStock: true } } as Sale)).toBe(100)
    expect(restockedVolume({ status: 'fulfilled', volumeLiters: 100 } as Sale)).toBe(0)
  })
})

describe('stockFor', () => {
  const purchases = [
    { status: 'received', warehouseId: 'w1', volumeLiters: 10_000 },
    { status: 'received', warehouseId: 'w1', volumeLiters: 5000, volumeReceived: 4800 },
    { status: 'ordered', warehouseId: 'w1', volumeLiters: 9000 },
    { status: 'received', warehouseId: 'w2', volumeLiters: 2000 },
  ] as Purchase[]
  const sales = [
    { status: 'fulfilled', warehouseId: 'w1', volumeLiters: 3000 },
    { status: 'draft', warehouseId: 'w1', volumeLiters: 8000 },
    { status: 'cancelled', warehouseId: 'w1', volumeLiters: 4000 },
    { status: 'fulfilled', warehouseId: 'w2', volumeLiters: 500 },
  ] as Sale[]

  it('agrees with the server on the same warehouse', () => {
    expect(stockFor(purchases, sales, 'w1')).toBe(11_800)
    expect(stockFor(purchases, sales, 'w2')).toBe(1500)
  })

  it('keeps products separate while treating blank as diesel', () => {
    const mixed = [
      { status: 'received', warehouseId: 'w1', volumeLiters: 1000 },
      { status: 'received', warehouseId: 'w1', productId: 'product-gas', volumeLiters: 400 },
    ] as Purchase[]
    expect(stockFor(mixed, [], 'w1')).toBe(1000)
    expect(stockFor(mixed, [], 'w1', 'product-diesel')).toBe(1000)
    expect(stockFor(mixed, [], 'w1', 'product-gas')).toBe(400)
  })

  it('reports an unknown warehouse as empty rather than throwing', () => {
    expect(stockFor(purchases, sales, 'nope')).toBe(0)
  })
})
