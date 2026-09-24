import { describe, expect, it } from 'vitest'
import { stockSaleVolume, receivedVolume, restockedVolume, stockFrom } from './stock'

/**
 * These cases are duplicated verbatim in src/lib/stockRules.test.ts, which runs
 * them against the client's implementations in src/lib/metrics.ts.
 *
 * That duplication is the point. The low supply warning (2.3) is evaluated
 * server-side, but every stock figure a user sees is computed client-side. If
 * the two rules drift, the warning fires against a number no screen shows - the
 * worst kind of bug, because it looks like the alert is broken rather than the
 * arithmetic. The two test files failing together is the tripwire.
 *
 * If you change a rule here, change it in src/lib/metrics.ts and update BOTH
 * case tables.
 */
export const SALE_CASES: { name: string; sale: Record<string, unknown>; expected: number }[] = [
  { name: 'draft consumes nothing', sale: { status: 'draft', volumeLiters: 1000 }, expected: 0 },
  { name: 'confirmed consumes the order', sale: { status: 'confirmed', volumeLiters: 1000 }, expected: 1000 },
  { name: 'fulfilled consumes the order', sale: { status: 'fulfilled', volumeLiters: 1000 }, expected: 1000 },
  { name: 'cancelled consumes nothing', sale: { status: 'cancelled', volumeLiters: 1000 }, expected: 0 },
  {
    name: 'return restocked in full consumes nothing',
    sale: { status: 'returned', volumeLiters: 1000, resolution: { treatment: 'restocked' } },
    expected: 0,
  },
  {
    name: 'partial return consumes the part that stuck',
    sale: { status: 'returned', volumeLiters: 1000, resolution: { treatment: 'restocked', volumeReturned: 300 } },
    expected: 700,
  },
  {
    name: 'refunded return still consumed the fuel',
    sale: { status: 'returned', volumeLiters: 1000, resolution: { treatment: 'refunded' } },
    expected: 1000,
  },
  {
    name: 'written-off return still consumed the fuel',
    sale: { status: 'returned', volumeLiters: 1000, resolution: { treatment: 'written_off', volumeReturned: 400 } },
    expected: 1000,
  },
  {
    name: 'over-large volumeReturned cannot create stock',
    sale: { status: 'returned', volumeLiters: 1000, resolution: { treatment: 'restocked', volumeReturned: 5000 } },
    expected: 0,
  },
  {
    name: 'refunded return whose fuel came back (new records) consumes nothing',
    sale: { status: 'returned', volumeLiters: 1000, resolution: { treatment: 'refunded', backToStock: true } },
    expected: 0,
  },
  {
    name: 'return whose fuel did not come back is still out of the tank',
    sale: { status: 'returned', volumeLiters: 1000, resolution: { treatment: 'credit_note', backToStock: false, volumeReturned: 400 } },
    expected: 1000,
  },
]

export const PURCHASE_CASES: { name: string; purchase: Record<string, unknown>; expected: number }[] = [
  { name: 'ordered but not received brings in nothing', purchase: { status: 'ordered', volumeLiters: 5000 }, expected: 0 },
  { name: 'received with no explicit receipt uses the order', purchase: { status: 'received', volumeLiters: 5000 }, expected: 5000 },
  { name: 'short delivery counts what arrived', purchase: { status: 'received', volumeLiters: 5000, volumeReceived: 4800 }, expected: 4800 },
  { name: 'over delivery counts what arrived', purchase: { status: 'received', volumeLiters: 5000, volumeReceived: 5200 }, expected: 5200 },
]

describe('server stock rules', () => {
  it.each(SALE_CASES)('stockSaleVolume: $name', ({ sale, expected }) => {
    expect(stockSaleVolume(sale)).toBe(expected)
  })

  it.each(PURCHASE_CASES)('receivedVolume: $name', ({ purchase, expected }) => {
    expect(receivedVolume(purchase)).toBe(expected)
  })

  it('only counts a restock when the treatment says so', () => {
    expect(restockedVolume({ status: 'returned', volumeLiters: 100, resolution: { treatment: 'restocked' } })).toBe(100)
    expect(restockedVolume({ status: 'returned', volumeLiters: 100, resolution: { treatment: 'refunded' } })).toBe(0)
    expect(restockedVolume({ status: 'fulfilled', volumeLiters: 100 })).toBe(0)
  })
})

describe('stockFrom', () => {
  const purchases = [
    { status: 'received', warehouseId: 'w1', volumeLiters: 10_000 },
    { status: 'received', warehouseId: 'w1', volumeLiters: 5000, volumeReceived: 4800 },
    { status: 'ordered', warehouseId: 'w1', volumeLiters: 9000 },
    { status: 'received', warehouseId: 'w2', volumeLiters: 2000 },
  ]
  const sales = [
    { status: 'fulfilled', warehouseId: 'w1', volumeLiters: 3000 },
    { status: 'draft', warehouseId: 'w1', volumeLiters: 8000 },
    { status: 'cancelled', warehouseId: 'w1', volumeLiters: 4000 },
    { status: 'fulfilled', warehouseId: 'w2', volumeLiters: 500 },
  ]

  it('nets received purchases against consuming sales, per warehouse', () => {
    // 10,000 + 4,800 received (the 9,000 order hasn't arrived) − 3,000 fulfilled.
    // The draft and the cancelled sale must not count.
    expect(stockFrom(purchases, sales, 'w1', 'product-diesel')).toBe(11_800)
    expect(stockFrom(purchases, sales, 'w2', 'product-diesel')).toBe(1500)
  })

  it('keeps products separate while treating blank as diesel', () => {
    const mixed = [
      { status: 'received', warehouseId: 'w1', volumeLiters: 1000 },
      { status: 'received', warehouseId: 'w1', productId: 'product-gas', volumeLiters: 400 },
    ]
    expect(stockFrom(mixed, [], 'w1', 'product-diesel')).toBe(1000)
    expect(stockFrom(mixed, [], 'w1', 'product-gas')).toBe(400)
  })

  it('reports an unknown warehouse as empty rather than throwing', () => {
    expect(stockFrom(purchases, sales, 'nope', 'product-diesel')).toBe(0)
  })
})
