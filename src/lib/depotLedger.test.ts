import { describe, expect, it } from 'vitest'
import { daysOfCoverTrailing, depotLedger, stockSeries, totalLedger, utilization } from './metrics'
import type { Purchase, Sale } from '../data/types'

/**
 * The client's stock comments, in order: the average that valued the tank
 * kept counting litres already sold (2, 3); cover was projected over days
 * that had not happened (1); and "what is in the tank came from where" had
 * no answer at all (6).
 */

const buy = (over: Partial<Purchase>): Purchase => ({
  id: 'p', createdAt: '', updatedAt: '', supplierId: 'shell', warehouseId: 'w1',
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

describe('depotLedger', () => {
  it('re-averages on each receipt against what is in the tank, not all-time', () => {
    // 1000 L at 50, sell 800, then 1000 L at 70. All-time average would be 60;
    // the tank holds 200 L of the 50 fuel and 1000 L of the 70 fuel.
    const l = depotLedger(
      [buy({ id: 'a', pricePerLiter: 50 }), buy({ id: 'b', date: '2026-03-10', pricePerLiter: 70, supplierId: 'petron' })],
      [sell({ volumeLiters: 800 })],
      'w1',
    )
    expect(l.onHand).toBe(1200)
    expect(l.avgCost).toBeCloseTo((200 * 50 + 1000 * 70) / 1200, 6)
    expect(l.value).toBeCloseTo(80_000, 6)
  })

  it('sales leave at the running average and do not change it', () => {
    const l = depotLedger([buy({ id: 'a', pricePerLiter: 50 }), buy({ id: 'b', date: '2026-03-02', pricePerLiter: 60 })], [sell({ volumeLiters: 500 })], 'w1')
    expect(l.avgCost).toBe(55)
    expect(l.onHand).toBe(1500)
  })

  it('attributes the tank to suppliers, and a sale draws from each in proportion', () => {
    const l = depotLedger(
      [buy({ id: 'a', supplierId: 'shell', volumeLiters: 3000 }), buy({ id: 'b', date: '2026-03-02', supplierId: 'petron', volumeLiters: 1000 })],
      [sell({ volumeLiters: 2000 })],
      'w1',
    )
    // 75/25 before the sale; still 75/25 after, of the 2000 left.
    expect(l.sources.shell).toBeCloseTo(1500, 6)
    expect(l.sources.petron).toBeCloseTo(500, 6)
  })

  it('can be read as of an earlier date', () => {
    const l = depotLedger([buy({ id: 'a' }), buy({ id: 'b', date: '2026-03-10', pricePerLiter: 70 })], [sell({})], 'w1', '2026-03-06')
    expect(l.onHand).toBe(600)
    expect(l.avgCost).toBe(50)
  })

  it('has no cost before anything is received', () => {
    const l = depotLedger([], [], 'w1')
    expect(l.avgCost).toBeNull()
    expect(l.value).toBeNull()
    expect(l.firstMovement).toBeNull()
  })

  it('sums the depots, and says how many could not be priced', () => {
    const t = totalLedger([buy({ id: 'a', warehouseId: 'w1' })], [], ['w1', 'w2'])
    expect(t.value).toBe(50_000)
    expect(t.unpriced).toBe(1)
    expect(t.sources.shell).toBe(1000)
  })
})

describe('daysOfCoverTrailing', () => {
  const now = new Date('2026-03-31T12:00:00Z')

  it('projects from the last 30 days of sales, whatever the range picker says', () => {
    const c = daysOfCoverTrailing(
      [buy({ id: 'a', date: '2026-01-01', volumeLiters: 10_000 })],
      [sell({ date: '2026-03-20', volumeLiters: 3000 }), sell({ id: 'y', date: '2026-01-15', volumeLiters: 5000 })],
      'w1', 30, now,
    )
    // Only the March sale is in the window: 3000 / 30 days = 100 L/day; 2000 L left.
    expect(c.windowDays).toBe(30)
    expect(c.days).toBeCloseTo(20, 6)
  })

  it('does not count days before the depot first traded', () => {
    const c = daysOfCoverTrailing(
      [buy({ id: 'a', date: '2026-03-22', volumeLiters: 1000 })],
      [sell({ date: '2026-03-25', volumeLiters: 500 })],
      'w1', 30, now,
    )
    // First movement Mar 22 → window is Mar 22–31, ten days: 50 L/day, 500 L left.
    expect(c.windowDays).toBe(10)
    expect(c.days).toBeCloseTo(10, 6)
  })

  it('is null when nothing went out in the window', () => {
    expect(daysOfCoverTrailing([buy({ id: 'a' })], [], 'w1', 30, now).days).toBeNull()
  })
})

describe('utilization', () => {
  it('averages the sampled fill against capacity', () => {
    const series = stockSeries([buy({ id: 'a', date: '2026-03-01', volumeLiters: 8000 })], [sell({ date: '2026-03-06', volumeLiters: 4000 })], ['w1'], { from: '2026-03-01', to: '2026-03-10' }, 10)
    const u = utilization(series, 'w1', 10_000)!
    expect(u.peak).toBeCloseTo(0.8, 6)
    expect(u.low).toBeCloseTo(0.4, 6)
    expect(u.avg).toBeGreaterThan(0.4)
    expect(u.avg).toBeLessThan(0.8)
  })

  it('is null without a capacity', () => {
    expect(utilization([{ t: 0, values: { w1: 100 } }], 'w1', 0)).toBeNull()
  })
})
