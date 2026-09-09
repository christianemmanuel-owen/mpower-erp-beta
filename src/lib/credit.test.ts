import { describe, expect, it } from 'vitest'
import { accountActivity, creditHistory, creditScore, customerInstallments, daysLate, isOverdue } from './credit'
import type { Customer, Sale, SaleInstallment } from '../data/types'

const NOW = Date.parse('2026-08-21T00:00:00.000Z')
const DAY = 86_400_000
const at = (offsetDays: number) => new Date(NOW + offsetDays * DAY).toISOString()

const inst = (over: Partial<SaleInstallment> = {}): SaleInstallment => ({
  id: 'i1', amount: 100_000, principal: 100_000, interestPct: 0,
  dueDate: at(-10), status: 'pending', ...over,
})

const customer: Customer = {
  id: 'c1', createdAt: '', updatedAt: '', company: 'Acme', brand: '',
  address: '', contactPerson: '', contactNumber: '', paymentTermDays: 30,
}

describe('isOverdue', () => {
  it('is overdue when still pending past the due date', () => {
    expect(isOverdue(inst({ status: 'pending', dueDate: at(-1) }), NOW)).toBe(true)
  })
  it('is not overdue before the due date', () => {
    expect(isOverdue(inst({ status: 'pending', dueDate: at(5) }), NOW)).toBe(false)
  })
  it('is never overdue once collected, however late it was', () => {
    expect(isOverdue(inst({ status: 'collected', dueDate: at(-90) }), NOW)).toBe(false)
  })
})

describe('daysLate', () => {
  it('counts days past the due date', () => {
    expect(daysLate(inst({ status: 'collected', dueDate: at(-10), collectedAt: at(-3) }))).toBe(7)
  })
  it('is negative for an early payment', () => {
    expect(daysLate(inst({ status: 'collected', dueDate: at(-10), collectedAt: at(-15) }))).toBe(-5)
  })
  it('is null without a collection timestamp - guessing would fabricate punctuality', () => {
    expect(daysLate(inst({ status: 'collected', dueDate: at(-10) }))).toBeNull()
  })
  it('is null for anything not collected', () => {
    expect(daysLate(inst({ status: 'pending' }))).toBeNull()
  })
})

describe('creditHistory', () => {
  it('reports nothing to go on for an account with no installments', () => {
    const h = creditHistory([], NOW)
    expect(h.punctuality).toBeNull()
    expect(h.ease).toBeNull()
    expect(h.rating).toBeNull()
  })

  it('scores a perfectly punctual account at 1', () => {
    const h = creditHistory([
      inst({ id: 'a', status: 'collected', dueDate: at(-30), collectedAt: at(-31) }),
      inst({ id: 'b', status: 'collected', dueDate: at(-20), collectedAt: at(-20) }),
    ], NOW)
    expect(h.punctuality).toBe(1)
    expect(h.ease).toBe(1)
    expect(h.rating).toBe('excellent')
  })

  it('treats payment on the due date itself as on time', () => {
    const h = creditHistory([inst({ status: 'collected', dueDate: at(-5), collectedAt: at(-5) })], NOW)
    expect(h.punctuality).toBe(1)
  })

  it('separates punctuality from the average lateness', () => {
    const h = creditHistory([
      inst({ id: 'a', status: 'collected', dueDate: at(-40), collectedAt: at(-40) }),
      inst({ id: 'b', status: 'collected', dueDate: at(-30), collectedAt: at(-20) }), // 10 late
      inst({ id: 'c', status: 'collected', dueDate: at(-25), collectedAt: at(-5) }),  // 20 late
    ], NOW)
    expect(h.punctuality).toBeCloseTo(1 / 3, 5)
    expect(h.lateSettled).toBe(2)
    expect(h.avgDaysLate).toBe(15)
  })

  it('excludes cancelled installments from every figure', () => {
    // A cancelled installment is not a payment outcome in either direction.
    const h = creditHistory([
      inst({ id: 'a', status: 'collected', dueDate: at(-10), collectedAt: at(-11) }),
      inst({ id: 'b', status: 'cancelled', dueDate: at(-50) }),
    ], NOW)
    expect(h.considered).toBe(1)
    expect(h.punctuality).toBe(1)
    expect(h.ease).toBe(1)
  })

  it('counts an overdue installment against ease and caps the rating', () => {
    const h = creditHistory([
      inst({ id: 'a', status: 'collected', dueDate: at(-40), collectedAt: at(-41) }),
      inst({ id: 'b', status: 'pending', dueDate: at(-3) }),
    ], NOW)
    expect(h.openOverdue).toBe(1)
    expect(h.ease).toBe(0.5)
    // Punctuality is untouched - nothing was collected late.
    expect(h.punctuality).toBe(1)
    expect(h.rating).toBe('watch')
  })

  it('ignores an installment that is pending but not yet due', () => {
    // It has not had the chance to be difficult.
    const h = creditHistory([
      inst({ id: 'a', status: 'collected', dueDate: at(-10), collectedAt: at(-11) }),
      inst({ id: 'b', status: 'pending', dueDate: at(+10) }),
    ], NOW)
    expect(h.ease).toBe(1)
    expect(h.openOverdue).toBe(0)
  })

  it('counts a bounced payment as friction and caps the rating', () => {
    const h = creditHistory([
      ...Array.from({ length: 9 }, (_, n) =>
        inst({ id: `ok${n}`, status: 'collected', dueDate: at(-40), collectedAt: at(-41) })),
      inst({ id: 'b', status: 'bounced', dueDate: at(-5) }),
    ], NOW)
    expect(h.bounced).toBe(1)
    expect(h.ease).toBe(0.9)
    // On-time rate alone would say 'excellent'; a bounced payment caps it.
    expect(h.onTimeRate).toBe(1)
    expect(h.rating).toBe('watch')
  })

  it('does not let an untimed collection count as late', () => {
    // Records written before collectedAt existed have no timestamp. They are
    // excluded from punctuality rather than assumed either way.
    const h = creditHistory([
      inst({ id: 'a', status: 'collected', dueDate: at(-10) }),
      inst({ id: 'b', status: 'collected', dueDate: at(-10), collectedAt: at(-12) }),
    ], NOW)
    expect(h.punctuality).toBe(1)
    expect(h.ease).toBe(1)
  })

  it('sums what is outstanding', () => {
    const h = creditHistory([
      inst({ id: 'a', status: 'pending', dueDate: at(-3), amount: 50_000 }),
      inst({ id: 'b', status: 'pending', dueDate: at(-9), amount: 25_000 }),
    ], NOW)
    expect(h.openOverdue).toBe(2)
    expect(h.overdueAmount).toBe(75_000)
  })

  it('grades a poor payer poorly', () => {
    const h = creditHistory([
      inst({ id: 'a', status: 'collected', dueDate: at(-40), collectedAt: at(-30) }),
      inst({ id: 'b', status: 'pending', dueDate: at(-20) }),
      inst({ id: 'c', status: 'pending', dueDate: at(-10) }),
    ], NOW)
    expect(h.rating).toBe('poor')
  })
})

describe('creditScore', () => {
  it('returns null until the Parties confirm the formula', () => {
    const score = creditScore(customer, creditHistory([], NOW))
    expect(score.value).toBeNull()
    expect(score.source).toBe('unavailable')
    expect(score.explanation).toMatch(/formula/i)
  })

  it('uses a manual override and says it was set by hand', () => {
    const score = creditScore({ ...customer, creditScoreOverride: 72 }, creditHistory([], NOW))
    expect(score.value).toBe(72)
    expect(score.source).toBe('manual')
    expect(score.explanation).toMatch(/by hand/i)
  })

  it('never reports a manual figure as computed', () => {
    const score = creditScore({ ...customer, creditScoreOverride: 90 }, creditHistory([], NOW))
    expect(score.source).not.toBe('formula')
  })
})

describe('customerInstallments', () => {
  const sale = (id: string, customerId: string, n: number, status: Sale['status'] = 'fulfilled'): Sale => ({
    id, createdAt: '', updatedAt: '', agentId: 'a1', customerId,
    date: at(-5), pricePerLiter: 60, volumeLiters: 1_000, warehouseId: 'w1',
    fulfillment: 'delivery', paymentMode: 'cash', status,
    installments: Array.from({ length: n }, (_, k) => inst({ id: `${id}-${k}` })),
  })

  it('gathers every installment across the customer’s sales', () => {
    const sales = [sale('s1', 'c1', 2), sale('s2', 'c2', 3), sale('s3', 'c1', 1)]
    expect(customerInstallments('c1', sales)).toHaveLength(3)
  })

  it('ignores draft sales - a quote is not a debt', () => {
    // Regression: a draft's installment rows are a proposed schedule. Counting
    // them meant an untouched quote aged past its notional due date and marked
    // the customer overdue for money nobody ever asked them for.
    const sales = [sale('s1', 'c1', 1), sale('s2', 'c1', 5, 'draft')]
    expect(customerInstallments('c1', sales)).toHaveLength(1)
  })

  it('never lets a stale draft drag an account’s rating down', () => {
    const good = { ...sale('s1', 'c1', 0), installments: [
      inst({ id: 'paid', status: 'collected', dueDate: at(-30), collectedAt: at(-31) }),
    ] }
    const staleQuote = { ...sale('s2', 'c1', 0, 'draft'), installments: [
      inst({ id: 'quote', status: 'pending', dueDate: at(-200) }),
    ] }
    const h = creditHistory(customerInstallments('c1', [good, staleQuote]), NOW)
    expect(h.openOverdue).toBe(0)
    expect(h.rating).toBe('excellent')
  })

  it('still counts payment behaviour on a returned order', () => {
    // The fuel went back; how they paid beforehand is exactly what this measures.
    const sales = [sale('s1', 'c1', 2, 'returned')]
    expect(customerInstallments('c1', sales)).toHaveLength(2)
  })

  it('ignores cancelled sales', () => {
    const sales = [sale('s1', 'c1', 2, 'cancelled')]
    expect(customerInstallments('c1', sales)).toHaveLength(0)
  })
})

describe('accountActivity', () => {
  const mk = (id: string, status: Sale['status']): Sale => ({
    id, createdAt: '', updatedAt: '', agentId: 'a1', customerId: 'c1',
    date: at(-5), pricePerLiter: 60, volumeLiters: 1_000, warehouseId: 'w1',
    fulfillment: 'delivery', paymentMode: 'cash', status, installments: [],
  })
  const always = () => true

  it('counts each kind of activity separately', () => {
    const sales = [
      mk('1', 'draft'), mk('2', 'draft'),
      mk('3', 'confirmed'), mk('4', 'fulfilled'),
      mk('5', 'cancelled'),
      mk('6', 'returned'),
    ]
    expect(accountActivity('c1', sales, always)).toEqual({
      inquiries: 2, successful: 2, cancelled: 1, returned: 1,
    })
  })

  it('only counts the account asked for', () => {
    const other = { ...mk('9', 'fulfilled'), customerId: 'c2' }
    expect(accountActivity('c1', [mk('1', 'fulfilled'), other], always).successful).toBe(1)
  })

  it('respects the interval', () => {
    const inAug = (d: string) => d.startsWith('2026-08')
    const old = { ...mk('1', 'fulfilled'), date: '2026-01-05T00:00:00.000Z' }
    expect(accountActivity('c1', [old, mk('2', 'fulfilled')], inAug).successful).toBe(1)
  })
})
