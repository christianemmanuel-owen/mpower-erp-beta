import { describe, expect, it } from 'vitest'
import { avgUnitCost, stockValue, totalStockValue } from './metrics'
import type { Purchase, Sale } from '../data/types'

const buy = (over: Partial<Purchase>): Purchase => ({
  id: 'p', createdAt: '', updatedAt: '', supplierId: 's', warehouseId: 'w1',
  date: '2026-03-01', volumeLiters: 1000, pricePerLiter: 50,
  status: 'received', fulfillment: 'delivered', paymentStatus: 'paid',
  ...over,
} as Purchase)

const sell = (over: Partial<Sale>): Sale => ({
  id: 'x', createdAt: '', updatedAt: '', customerId: 'c', warehouseId: 'w1',
  date: '2026-03-05', volumeLiters: 400, pricePerLiter: 60,
  status: 'fulfilled', installments: [],
  ...over,
} as unknown as Sale)

describe('avgUnitCost', () => {
  it('weights by volume, not by number of purchases', () => {
    // A mean of the two prices would be ₱40. Nearly all the fuel came in at 30.
    const rate = avgUnitCost([
      buy({ id: 'a', volumeLiters: 100, pricePerLiter: 50 }),
      buy({ id: 'b', volumeLiters: 9900, pricePerLiter: 30 }),
    ])
    expect(rate).toBeCloseTo((100 * 50 + 9900 * 30) / 10_000, 6)
    expect(rate).toBeLessThan(31)
  })

  it('prices on what arrived, not what was ordered', () => {
    const rate = avgUnitCost([buy({ volumeLiters: 1000, volumeReceived: 800, pricePerLiter: 50 })])
    expect(rate).toBe(50)
    expect(stockValue([buy({ volumeLiters: 1000, volumeReceived: 800, pricePerLiter: 50 })], [], 'w1')).toBe(800 * 50)
  })

  it('ignores purchases still on order', () => {
    expect(avgUnitCost([buy({ status: 'ordered' })])).toBeNull()
  })

  it('has no rate rather than a rate of zero when nothing was received', () => {
    // Zero would value a full tank at nothing, which reads as a real figure.
    expect(avgUnitCost([])).toBeNull()
    expect(stockValue([], [], 'w1')).toBeNull()
  })
})

describe('stockValue', () => {
  it('values what is left after sales', () => {
    const v = stockValue([buy({ volumeLiters: 1000, pricePerLiter: 50 })], [sell({ volumeLiters: 400 })], 'w1')
    expect(v).toBe(600 * 50)
  })

  it('never values an oversold depot at less than nothing', () => {
    const v = stockValue([buy({ volumeLiters: 100 })], [sell({ volumeLiters: 400 })], 'w1')
    expect(v).toBe(0)
  })

  it('prices each depot on its own purchases', () => {
    const purchases = [
      buy({ id: 'a', warehouseId: 'w1', volumeLiters: 1000, pricePerLiter: 50 }),
      buy({ id: 'b', warehouseId: 'w2', volumeLiters: 1000, pricePerLiter: 20 }),
    ]
    expect(stockValue(purchases, [], 'w1')).toBe(50_000)
    expect(stockValue(purchases, [], 'w2')).toBe(20_000)
  })
})

describe('totalStockValue', () => {
  it('sums the depots rather than pricing total volume at one blended rate', () => {
    // The two disagree whenever depots buy at different prices, and a total that
    // disagrees with the column above it is worse than no total.
    const purchases = [
      buy({ id: 'a', warehouseId: 'w1', volumeLiters: 1000, pricePerLiter: 50 }),
      buy({ id: 'b', warehouseId: 'w2', volumeLiters: 9000, pricePerLiter: 20 }),
    ]
    const sales = [sell({ warehouseId: 'w2', volumeLiters: 8000 })]
    const { total } = totalStockValue(purchases, sales, ['w1', 'w2'])
    expect(total).toBe(1000 * 50 + 1000 * 20)

    // The blended-rate shortcut would say something else entirely.
    const blended = avgUnitCost(purchases)!
    expect(2000 * blended).not.toBeCloseTo(total, 0)
  })

  it('reports depots it could not price instead of counting them as zero', () => {
    const purchases = [buy({ warehouseId: 'w1' })]
    const r = totalStockValue(purchases, [], ['w1', 'w2'])
    expect(r.unpriced).toBe(1)
    expect(r.priced).toBe(1)
    expect(r.total).toBe(1000 * 50)
  })
})
