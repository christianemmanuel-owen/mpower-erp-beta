import { describe, expect, it } from 'vitest'
import { commissionLines, commissionTotal, pendingCommission } from './commission'
import type { CommissionRate, Sale, SaleInstallment } from '../data/types'

/**
 * The collection gate is a compliance requirement, not a nicety: paying
 * commission on money that never arrives is a real cash loss. These tests pin
 * the gate itself, the period it belongs to, and the proportional release.
 */

const perLiter: CommissionRate = { kind: 'per_liter', value: 0.5 }
const percent: CommissionRate = { kind: 'percent_of_sale', value: 2 }

const inst = (over: Partial<SaleInstallment> = {}): SaleInstallment => ({
  id: 'i1', amount: 310_000, principal: 310_000, interestPct: 0,
  dueDate: '2026-08-10T00:00:00.000Z', status: 'pending', ...over,
})

/** 5,000 L at ₱62 = ₱310,000. */
const sale = (over: Partial<Sale> = {}): Sale => ({
  id: 's1', createdAt: '', updatedAt: '', agentId: 'ag1', customerId: 'c1',
  date: '2026-01-15T00:00:00.000Z', pricePerLiter: 62, volumeLiters: 5_000, warehouseId: 'w1',
  fulfillment: 'delivery', paymentMode: 'check', status: 'fulfilled',
  installments: [inst()], ...over,
})

const AUG = { start: '2026-08-01', end: '2026-08-31' }
const total = (s: Sale[], rate = percent, p = AUG) =>
  commissionTotal(commissionLines('ag1', rate, s, p.start, p.end))

describe('the collection gate', () => {
  it('pays nothing on a fulfilled sale that has not been collected', () => {
    // The old behaviour paid here. That is the bug.
    expect(total([sale({ installments: [inst({ status: 'pending' })] })])).toBe(0)
  })

  it('pays once the money is recorded as collected', () => {
    const s = sale({ installments: [inst({ status: 'collected', collectedAt: '2026-08-12T00:00:00.000Z' })] })
    expect(total([s])).toBe(6_200) // 310,000 × 2%
  })

  it('pays nothing on a bounced payment - the money did not arrive', () => {
    expect(total([sale({ installments: [inst({ status: 'bounced' })] })])).toBe(0)
  })

  it('pays nothing on a cancelled installment', () => {
    expect(total([sale({ installments: [inst({ status: 'cancelled' })] })])).toBe(0)
  })

  it('pays nothing on a cancelled sale, even if an installment sits collected', () => {
    const s = sale({
      status: 'cancelled',
      installments: [inst({ status: 'collected', collectedAt: '2026-08-12T00:00:00.000Z' })],
    })
    expect(total([s])).toBe(0)
  })

  it('pays nothing on a draft sale', () => {
    const s = sale({
      status: 'draft',
      installments: [inst({ status: 'collected', collectedAt: '2026-08-12T00:00:00.000Z' })],
    })
    expect(total([s])).toBe(0)
  })
})

describe('which period the commission lands in', () => {
  it('uses the collection date, not the sale date', () => {
    // The sale is from January; the money arrived in August. Paying on sale date
    // would mean this commission is never paid at all - January's run saw it
    // uncollected, and August's run would not recognise the sale.
    const s = sale({
      date: '2026-01-15T00:00:00.000Z',
      installments: [inst({ status: 'collected', collectedAt: '2026-08-12T00:00:00.000Z' })],
    })
    expect(total([s])).toBe(6_200)
    expect(total([s], percent, { start: '2026-01-01', end: '2026-01-31' })).toBe(0)
  })

  it('includes a collection on the first and last day of the period', () => {
    const first = sale({ id: 'a', installments: [inst({ status: 'collected', collectedAt: '2026-08-01T00:00:00.000Z' })] })
    const last = sale({ id: 'b', installments: [inst({ status: 'collected', collectedAt: '2026-08-31T23:00:00.000Z' })] })
    expect(total([first])).toBe(6_200)
    expect(total([last])).toBe(6_200)
  })

  it('excludes a collection from the following period', () => {
    const s = sale({ installments: [inst({ status: 'collected', collectedAt: '2026-09-01T00:00:00.000Z' })] })
    expect(total([s])).toBe(0)
  })

  it('falls back to the due date when no collection timestamp was recorded', () => {
    // Dropping the commission entirely would be worse than using what the record
    // itself claims about when the money was expected.
    const s = sale({ installments: [inst({ status: 'collected', dueDate: '2026-08-10T00:00:00.000Z' })] })
    expect(total([s])).toBe(6_200)
  })
})

describe('proportional release across an installment plan', () => {
  const plan = (over: Partial<SaleInstallment>[] = []) => sale({
    installments: [
      inst({ id: 'a', principal: 93_000, amount: 93_000, ...over[0] }),   // 30%
      inst({ id: 'b', principal: 217_000, amount: 217_000, ...over[1] }), // 70%
    ],
  })

  it('releases only the share that has been collected', () => {
    const s = plan([{ status: 'collected', collectedAt: '2026-08-12T00:00:00.000Z' }])
    expect(total([s])).toBe(1_860) // 93,000 × 2%
  })

  it('releases the rest when the final installment lands', () => {
    const s = plan([
      { status: 'collected', collectedAt: '2026-07-12T00:00:00.000Z' },
      { status: 'collected', collectedAt: '2026-08-12T00:00:00.000Z' },
    ])
    expect(total([s])).toBe(4_340) // 217,000 × 2%, July's share not counted again
  })

  it('sums to the full commission once every installment is collected', () => {
    const s = plan([
      { status: 'collected', collectedAt: '2026-08-05T00:00:00.000Z' },
      { status: 'collected', collectedAt: '2026-08-20T00:00:00.000Z' },
    ])
    expect(total([s])).toBe(6_200)
  })
})

describe('what is commissionable', () => {
  it('does not pay commission on financing interest', () => {
    // principal is the share of the invoice; amount carries the finance charge.
    // The agent sold fuel, not credit.
    const s = sale({
      installments: [inst({ status: 'collected', collectedAt: '2026-08-12T00:00:00.000Z', principal: 310_000, interestPct: 10, amount: 341_000 })],
    })
    expect(total([s])).toBe(6_200)
  })

  it('pays per-litre commission on the litres behind the collection', () => {
    const s = sale({ installments: [inst({ status: 'collected', collectedAt: '2026-08-12T00:00:00.000Z' })] })
    expect(total([s], perLiter)).toBe(2_500) // 5,000 L × ₱0.50
  })

  it('scales per-litre commission to a part-collected plan', () => {
    const s = sale({
      installments: [
        inst({ id: 'a', principal: 155_000, amount: 155_000, status: 'collected', collectedAt: '2026-08-12T00:00:00.000Z' }),
        inst({ id: 'b', principal: 155_000, amount: 155_000 }),
      ],
    })
    expect(total([s], perLiter)).toBe(1_250) // half the litres
  })

  it('pays only for the part of a returned order that stuck', () => {
    // 1,000 of 5,000 L came back, so 80% was actually sold.
    const s = sale({
      status: 'returned',
      resolution: { date: '2026-08-15T00:00:00.000Z', reason: 'Short-filled', treatment: 'restocked', volumeReturned: 1_000 },
      installments: [inst({ status: 'collected', collectedAt: '2026-08-12T00:00:00.000Z' })],
    })
    expect(total([s])).toBe(4_960) // 6,200 × 0.8
  })

  it('pays nothing on an order returned in full', () => {
    const s = sale({
      status: 'returned',
      resolution: { date: '2026-08-15T00:00:00.000Z', reason: 'Rejected', treatment: 'restocked' },
      installments: [inst({ status: 'collected', collectedAt: '2026-08-12T00:00:00.000Z' })],
    })
    expect(total([s])).toBe(0)
  })

  it('only counts the agent asked for', () => {
    const mine = sale({ id: 'a', installments: [inst({ status: 'collected', collectedAt: '2026-08-12T00:00:00.000Z' })] })
    const theirs = sale({ id: 'b', agentId: 'ag2', installments: [inst({ status: 'collected', collectedAt: '2026-08-12T00:00:00.000Z' })] })
    expect(total([mine, theirs])).toBe(6_200)
  })

  it('pays nothing without a commission rate', () => {
    const s = sale({ installments: [inst({ status: 'collected', collectedAt: '2026-08-12T00:00:00.000Z' })] })
    expect(commissionLines('ag1', { kind: 'percent_of_sale', value: 0 }, [s], AUG.start, AUG.end)).toEqual([])
  })

  it('survives a zero-value sale without dividing by zero', () => {
    const s = sale({
      volumeLiters: 0, pricePerLiter: 0,
      installments: [inst({ status: 'collected', collectedAt: '2026-08-12T00:00:00.000Z', principal: 0, amount: 0 })],
    })
    expect(total([s])).toBe(0)
    expect(Number.isFinite(total([s]))).toBe(true)
  })
})

describe('commissionLines', () => {
  it('shows its working, oldest collection first', () => {
    const s = sale({
      installments: [
        inst({ id: 'b', principal: 155_000, amount: 155_000, status: 'collected', collectedAt: '2026-08-20T00:00:00.000Z' }),
        inst({ id: 'a', principal: 155_000, amount: 155_000, status: 'collected', collectedAt: '2026-08-05T00:00:00.000Z' }),
      ],
    })
    const lines = commissionLines('ag1', percent, [s], AUG.start, AUG.end)
    expect(lines.map((l) => l.installmentId)).toEqual(['a', 'b'])
    expect(lines[0].commissionableAmount).toBe(155_000)
  })
})

describe('pendingCommission', () => {
  it('reports what is waiting on collection', () => {
    const s = sale({ installments: [inst({ status: 'pending' })] })
    expect(pendingCommission('ag1', percent, [s])).toBe(6_200)
  })

  it('counts a bounced payment as still waiting', () => {
    const s = sale({ installments: [inst({ status: 'bounced' })] })
    expect(pendingCommission('ag1', percent, [s])).toBe(6_200)
  })

  it('stops counting once the money is in', () => {
    const s = sale({ installments: [inst({ status: 'collected', collectedAt: '2026-08-12T00:00:00.000Z' })] })
    expect(pendingCommission('ag1', percent, [s])).toBe(0)
  })

  it('ignores cancelled installments - that money is never coming', () => {
    const s = sale({ installments: [inst({ status: 'cancelled' })] })
    expect(pendingCommission('ag1', percent, [s])).toBe(0)
  })
})
