import { describe, expect, it } from 'vitest'
import { stockOnDate } from './metrics'
import type { Purchase, Sale } from '../data/types'

const purchase = (volume: number): Purchase => ({
  id: 'p1', createdAt: '', updatedAt: '', supplierId: 'sup1',
  date: '2026-01-01T00:00:00.000Z', pricePerLiter: 40, volumeLiters: volume,
  warehouseId: 'w1', fulfillment: 'delivered', paymentMode: 'bank_transfer',
  status: 'received', installments: [],
} as unknown as Purchase)

const sale = (id: string, volume: number, scheduleDate: string, status: Sale['status']): Sale => ({
  id, createdAt: '', updatedAt: '', agentId: 'a1', customerId: 'c1',
  date: '2026-01-02T00:00:00.000Z', pricePerLiter: 55, volumeLiters: volume,
  warehouseId: 'w1', fulfillment: 'delivery', paymentMode: 'cash',
  scheduleDate, status, installments: [],
} as unknown as Sale)

describe('what a depot can promise on a day', () => {
  /**
   * Stock on hand has every confirmed order taken off it whenever it leaves.
   * An order booked for the 10th can still use the litres that a confirmed
   * order is not collecting until the 20th.
   */
  it('adds back the confirmed orders that leave after the day', () => {
    const purchases = [purchase(50_000)]
    const sales = [
      sale('s1', 10_000, '2026-01-20T00:00:00.000Z', 'confirmed'),
      sale('s2', 5_000, '2026-01-05T00:00:00.000Z', 'confirmed'),
    ]
    // On hand: 50,000 less both confirmed orders = 35,000.
    const on10th = stockOnDate(purchases, sales, 'w1', '2026-01-10')
    expect(on10th.onHand).toBe(35_000)
    // The 20th's order has not gone yet on the 10th, so its litres are free.
    expect(on10th.leavingLater).toBe(10_000)
    expect(on10th.available).toBe(45_000)

    // On the 25th both have gone.
    expect(stockOnDate(purchases, sales, 'w1', '2026-01-25').available).toBe(35_000)
  })

  it('counts only that depot, and only confirmed orders', () => {
    const sales = [
      sale('s1', 10_000, '2026-01-20T00:00:00.000Z', 'draft'),
      sale('s2', 4_000, '2026-01-20T00:00:00.000Z', 'fulfilled'),
    ]
    const r = stockOnDate([purchase(20_000)], sales, 'w1', '2026-01-10')
    // The draft never touched stock; the fulfilled one has gone for good.
    expect(r.onHand).toBe(16_000)
    expect(r.leavingLater).toBe(0)
    expect(stockOnDate([purchase(20_000)], sales, 'w2', '2026-01-10').available).toBe(0)
  })
})
