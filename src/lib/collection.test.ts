import { describe, expect, it } from 'vitest'
import { collectionRate, installmentEntries, rateByCollector, rateByCustomer, rateOverall } from './collection'
import type { Sale, SaleInstallment } from '../data/types'

const NOW = Date.parse('2026-08-21T00:00:00.000Z')
const DAY = 86_400_000
const at = (d: number) => new Date(NOW + d * DAY).toISOString()

const inst = (over: Partial<SaleInstallment> = {}): SaleInstallment => ({
  id: 'i1', amount: 100_000, principal: 100_000, interestPct: 0,
  dueDate: at(-10), status: 'pending', ...over,
})

const sale = (over: Partial<Sale> = {}): Sale => ({
  id: 's1', createdAt: '', updatedAt: '', agentId: 'a1', customerId: 'c1',
  date: at(-40), pricePerLiter: 60, volumeLiters: 5_000, warehouseId: 'w1',
  fulfillment: 'delivery', paymentMode: 'check', status: 'fulfilled',
  installments: [], ...over,
})

/** Collected n days after the due date. */
const settled = (id: string, lateBy: number, over: Partial<SaleInstallment> = {}) =>
  inst({ id, status: 'collected', dueDate: at(-30), collectedAt: at(-30 + lateBy), ...over })

describe('installmentEntries', () => {
  it('pairs every installment with the sale it came from', () => {
    const entries = installmentEntries([
      sale({ id: 'a', installments: [inst({ id: '1' }), inst({ id: '2' })] }),
      sale({ id: 'b', installments: [inst({ id: '3' })] }),
    ])
    expect(entries).toHaveLength(3)
    expect(entries[2].sale.id).toBe('b')
  })

  it('leaves out orders that were never collectable', () => {
    // A draft has nothing to collect yet and a cancelled order has nothing to
    // collect any more. Counting either put money in the on-time denominator
    // that nobody could ever have collected, and made the strip's open count
    // disagree with the on-time figure's on the same screen.
    const entries = installmentEntries([
      sale({ id: 'draft', status: 'draft', installments: [inst({ id: '1', dueDate: at(-30) })] }),
      sale({ id: 'void', status: 'cancelled', installments: [inst({ id: '2', dueDate: at(-30) })] }),
      sale({ id: 'real', status: 'fulfilled', installments: [inst({ id: '3', dueDate: at(-30) })] }),
    ])
    expect(entries.map((e) => e.sale.id)).toEqual(['real'])
  })

  it('keeps a returned order, which still owes what was not sent back', () => {
    const entries = installmentEntries([
      sale({ id: 'returned', status: 'returned', installments: [inst({ id: '1' })] }),
    ])
    expect(entries).toHaveLength(1)
  })
})

describe('collectionRate', () => {
  const rate = (installments: SaleInstallment[]) =>
    collectionRate(installmentEntries([sale({ installments })]), NOW)

  it('has nothing to report when nothing has concluded', () => {
    expect(rate([inst({ status: 'pending', dueDate: at(+5) })]).onTimeRate).toBeNull()
  })

  it('scores a punctual collector at 100%', () => {
    expect(rate([settled('a', -1), settled('b', 0)]).onTimeRate).toBe(1)
  })

  it('treats collection on the due date as on time', () => {
    expect(rate([settled('a', 0)]).onTimeRate).toBe(1)
  })

  it('counts a late collection against the rate and reports the lateness', () => {
    const r = rate([settled('a', 0), settled('b', 12)])
    expect(r.onTimeRate).toBe(0.5)
    expect(r.late).toBe(1)
    expect(r.avgDaysLate).toBe(12)
  })

  it('counts a bounced payment against the collector - the money did not arrive', () => {
    const r = rate([settled('a', 0), inst({ id: 'b', status: 'bounced', dueDate: at(-5) })])
    expect(r.bounced).toBe(1)
    expect(r.onTimeRate).toBe(0.5)
  })

  it('counts money still outstanding past due against the rate', () => {
    const r = rate([settled('a', 0), inst({ id: 'b', status: 'pending', dueDate: at(-3) })])
    expect(r.openOverdue).toBe(1)
    expect(r.onTimeRate).toBe(0.5)
  })

  it('ignores an installment that is not due yet', () => {
    // It has not had the chance to be late.
    const r = rate([settled('a', 0), inst({ id: 'b', status: 'pending', dueDate: at(+30) })])
    expect(r.onTimeRate).toBe(1)
    expect(r.concluded).toBe(1)
  })

  it('excludes cancelled installments entirely', () => {
    const r = rate([settled('a', 0), inst({ id: 'b', status: 'cancelled', dueDate: at(-99) })])
    expect(r.onTimeRate).toBe(1)
    expect(r.concluded).toBe(1)
  })

  it('leaves an untimed collection out of both sides of the ratio', () => {
    // Counting it on time flatters the collector; counting it late punishes
    // record-keeping rather than performance.
    const r = rate([settled('a', 0), inst({ id: 'b', status: 'collected', dueDate: at(-10) })])
    expect(r.settled).toBe(2)
    expect(r.judged).toBe(1)
    expect(r.onTimeRate).toBe(1)
  })

  it('sums what was collected and what is still outstanding', () => {
    const r = rate([
      settled('a', 0, { amount: 40_000 }),
      inst({ id: 'b', status: 'pending', dueDate: at(-2), amount: 25_000 }),
    ])
    expect(r.settledAmount).toBe(40_000)
    expect(r.overdueAmount).toBe(25_000)
  })
})

describe('rateByCollector', () => {
  it('attributes an installment to its own collector over the sale default', () => {
    const sales = [sale({
      collectorId: 'default',
      installments: [settled('a', 0, { collectorId: 'specific' })],
    })]
    const rows = rateByCollector(sales, NOW)
    expect(rows).toHaveLength(1)
    expect(rows[0].key).toBe('specific')
  })

  it('falls back to the sale collector when the installment has none', () => {
    const sales = [sale({ collectorId: 'default', installments: [settled('a', 0)] })]
    expect(rateByCollector(sales, NOW)[0].key).toBe('default')
  })

  it('groups unattributed collections under null rather than hiding them', () => {
    // Unassigned collections are exactly the ones that go unchased.
    const sales = [sale({ installments: [inst({ status: 'pending', dueDate: at(-5) })] })]
    const rows = rateByCollector(sales, NOW)
    expect(rows[0].key).toBeNull()
    expect(rows[0].rate.openOverdue).toBe(1)
  })

  it('ranks the better collector first', () => {
    const sales = [
      sale({ id: 's1', installments: [settled('a', 0, { collectorId: 'good' })] }),
      sale({ id: 's2', installments: [settled('b', 20, { collectorId: 'poor' })] }),
    ]
    expect(rateByCollector(sales, NOW).map((r) => r.key)).toEqual(['good', 'poor'])
  })

  it('keeps two collectors on the same sale apart', () => {
    const sales = [sale({
      collectorId: 'default',
      installments: [
        settled('a', 0, { collectorId: 'alice' }),
        settled('b', 15, { collectorId: 'bob' }),
      ],
    })]
    const rows = rateByCollector(sales, NOW)
    expect(rows.find((r) => r.key === 'alice')?.rate.onTimeRate).toBe(1)
    expect(rows.find((r) => r.key === 'bob')?.rate.onTimeRate).toBe(0)
  })
})

describe('rateByCustomer', () => {
  it('groups by client across all their sales', () => {
    const sales = [
      sale({ id: 's1', customerId: 'acme', installments: [settled('a', 0)] }),
      sale({ id: 's2', customerId: 'acme', installments: [settled('b', 9)] }),
      sale({ id: 's3', customerId: 'other', installments: [settled('c', 0)] }),
    ]
    const rows = rateByCustomer(sales, NOW)
    expect(rows.find((r) => r.key === 'acme')?.rate.onTimeRate).toBe(0.5)
    expect(rows.find((r) => r.key === 'other')?.rate.onTimeRate).toBe(1)
  })
})

describe('rateOverall', () => {
  it('agrees with the sum of its parts', () => {
    const sales = [
      sale({ id: 's1', customerId: 'a', installments: [settled('a', 0), settled('b', 5)] }),
      sale({ id: 's2', customerId: 'b', installments: [settled('c', 0), settled('d', 0)] }),
    ]
    const overall = rateOverall(sales, NOW)
    expect(overall.judged).toBe(4)
    expect(overall.onTime).toBe(3)
    expect(overall.onTimeRate).toBe(0.75)

    // The per-client cut must partition the same population, not a different one.
    const byCustomer = rateByCustomer(sales, NOW)
    expect(byCustomer.reduce((s, r) => s + r.rate.judged, 0)).toBe(overall.judged)
    expect(byCustomer.reduce((s, r) => s + r.rate.onTime, 0)).toBe(overall.onTime)
  })
})
