import { describe, expect, it } from 'vitest'
import { billedVolume, daysOfCover, purchaseInDate, stockMovements, volumeIn, warehouseFlow } from './metrics'
import type { Purchase, Sale } from '../data/types'

/**
 * Exhibit A 1.2 - "total volume in within a date interval".
 *
 * These pin two rules that were previously wrong in ways no test caught:
 * a load counts against the period it ARRIVED in, and it is costed on what
 * actually arrived.
 */

const base = {
  id: 'p1', createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z',
  supplierId: 's1', warehouseId: 'w1', pricePerLiter: 50, paymentMode: 'cash',
  installments: [], fulfillment: 'delivered', address: '',
} as unknown as Purchase

const purchase = (over: Partial<Purchase>): Purchase => ({ ...base, ...over } as Purchase)

const JULY = { from: '2026-07-01T00:00:00.000Z', to: '2026-07-31T23:59:59.999Z' }
const JUNE = { from: '2026-06-01T00:00:00.000Z', to: '2026-06-30T23:59:59.999Z' }

describe('purchaseInDate', () => {
  it('uses the arrival date when the receipt recorded one', () => {
    expect(purchaseInDate(purchase({ date: '2026-06-28T00:00:00.000Z', receivedAt: '2026-07-03T00:00:00.000Z' })))
      .toBe('2026-07-03T00:00:00.000Z')
  })

  it('falls back to the order date for purchases received before the field existed', () => {
    expect(purchaseInDate(purchase({ date: '2026-06-28T00:00:00.000Z' })))
      .toBe('2026-06-28T00:00:00.000Z')
  })
})

describe('volumeIn', () => {
  const orderedJuneArrivedJuly = purchase({
    status: 'received', volumeLiters: 10_000, volumeReceived: 9_650,
    date: '2026-06-28T00:00:00.000Z', receivedAt: '2026-07-03T00:00:00.000Z',
  })

  it('counts a load against the month it arrived in, not the month it was ordered', () => {
    expect(volumeIn([orderedJuneArrivedJuly], JULY)).toBe(9_650)
    expect(volumeIn([orderedJuneArrivedJuly], JUNE)).toBe(0)
  })

  it('ignores purchases that have not arrived', () => {
    expect(volumeIn([purchase({ status: 'ordered', volumeLiters: 10_000, date: '2026-07-05T00:00:00.000Z' })], JULY))
      .toBe(0)
  })

  it('still counts legacy receipts with no arrival stamp, by order date', () => {
    expect(volumeIn([purchase({ status: 'received', volumeLiters: 8_000, date: '2026-07-05T00:00:00.000Z' })], JULY))
      .toBe(8_000)
  })
})

describe('billedVolume', () => {
  it('costs a received purchase on what actually arrived', () => {
    // The table, the xlsx export and the KPI strip previously disagreed here:
    // two used the ordered volume while the installment re-spread used delivered.
    expect(billedVolume(purchase({ status: 'received', volumeLiters: 10_000, volumeReceived: 9_650 }))).toBe(9_650)
  })

  it('costs an open purchase on what was ordered - the commitment still stands', () => {
    expect(billedVolume(purchase({ status: 'ordered', volumeLiters: 10_000 }))).toBe(10_000)
  })

  it('treats a received purchase with no recorded figure as a full delivery', () => {
    expect(billedVolume(purchase({ status: 'received', volumeLiters: 10_000 }))).toBe(10_000)
  })
})

/**
 * Exhibit A 1.2 - "volume out traced to the originating Sales or Logistics
 * record". The page could previously only show an aggregate.
 */
describe('stockMovements', () => {
  const received = purchase({
    id: 'p9', status: 'received', volumeLiters: 10_000, volumeReceived: 9_650,
    date: '2026-07-01T00:00:00.000Z', receivedAt: '2026-07-03T00:00:00.000Z',
    warehouseId: 'w1', supplierId: 'sup1',
  })
  const sale = {
    id: 's9', date: '2026-07-10T00:00:00.000Z', warehouseId: 'w1',
    customerId: 'c1', volumeLiters: 4_000, status: 'fulfilled', pricePerLiter: 60,
    installments: [], createdAt: '', updatedAt: '',
  } as unknown as Sale

  it('traces every movement back to the record it came from', () => {
    const moves = stockMovements([received], [sale], JULY)
    expect(moves.map((m) => [m.tbl, m.recordId, m.liters])).toEqual([
      ['sales', 's9', -4_000],
      ['purchases', 'p9', 9_650],
    ])
  })

  it('dates a receipt by arrival, so it lands in the right period', () => {
    expect(stockMovements([received], [], JULY)).toHaveLength(1)
    expect(stockMovements([received], [], JUNE)).toHaveLength(0)
  })

  it('records a restocked return as fuel coming back, not as a smaller sale', () => {
    const returned = {
      ...sale, id: 's10', status: 'returned',
      resolution: { treatment: 'restocked', volumeReturned: 1_500 },
    } as unknown as Sale
    const moves = stockMovements([], [returned], JULY)
    // The full 4,000 left and 1,500 came back - two trips, not one net movement.
    expect(moves.find((m) => m.kind === 'sale')?.liters).toBe(-4_000)
    expect(moves.find((m) => m.kind === 'return')?.liters).toBe(1_500)
  })

  it('ignores purchases that never arrived', () => {
    expect(stockMovements([purchase({ id: 'p10', status: 'ordered', volumeLiters: 5_000, date: '2026-07-02T00:00:00.000Z' })], [], JULY))
      .toHaveLength(0)
  })
})

describe('warehouseFlow', () => {
  it('reports in, out and net for one depot - the per-warehouse half of 1.2', () => {
    const p = purchase({ id: 'p11', status: 'received', volumeLiters: 8_000, warehouseId: 'w1', date: '2026-07-04T00:00:00.000Z' })
    const s = { id: 's11', date: '2026-07-06T00:00:00.000Z', warehouseId: 'w1', customerId: 'c1',
      volumeLiters: 3_000, status: 'fulfilled', pricePerLiter: 60, installments: [], createdAt: '', updatedAt: '' } as unknown as Sale
    const other = { ...s, id: 's12', warehouseId: 'w2' } as unknown as Sale
    expect(warehouseFlow([p], [s, other], 'w1', JULY)).toEqual({ in: 8_000, out: 3_000, net: 5_000 })
  })
})

describe('daysOfCover', () => {
  const JULY_DAYS = 31
  const p = (over: Partial<Purchase>) => purchase({
    status: 'received', warehouseId: 'w1', volumeLiters: 31_000,
    date: '2026-07-01T00:00:00.000Z', ...over,
  })
  const s = (over: Record<string, unknown> = {}) => ({
    id: 's1', date: '2026-07-10T00:00:00.000Z', warehouseId: 'w1', customerId: 'c1',
    volumeLiters: 3_100, status: 'fulfilled', pricePerLiter: 60, installments: [],
    createdAt: '', updatedAt: '', ...over,
  } as unknown as Sale)

  it('projects on-hand against the recent daily rate', () => {
    // In 31,000, out 3,100 over 31 days = 100 L/day. 27,900 left = 279 days.
    const cover = daysOfCover([p({ id: 'p1' })], [s()], 'w1', JULY)
    expect(cover).not.toBeNull()
    expect(Math.round(cover!)).toBe(279)
    expect(JULY_DAYS).toBe(31)
  })

  it('returns null when nothing went out, rather than claiming infinite cover', () => {
    // A quiet month is not a depot that will never run dry.
    expect(daysOfCover([p({ id: 'p2' })], [], 'w1', JULY)).toBeNull()
  })

  it('returns zero cover for an empty depot that is still selling', () => {
    expect(daysOfCover([], [s({ id: 's2' })], 'w1', JULY)).toBe(0)
  })

  it('ignores other depots entirely', () => {
    const cover = daysOfCover([p({ id: 'p3' })], [s({ id: 's3', warehouseId: 'w2' })], 'w1', JULY)
    expect(cover).toBeNull()
  })
})
