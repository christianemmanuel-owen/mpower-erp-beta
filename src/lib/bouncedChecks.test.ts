import { describe, expect, it } from 'vitest'
import { bouncedFor, bouncedNote, estafaStep } from './bouncedChecks'
import type { Sale } from '../data/types'

const sale = (customerId: string, ...amounts: [number, string][]): Sale => ({
  id: 's' + amounts.length, createdAt: '', updatedAt: '',
  agentId: 'a1', customerId, date: '2026-01-01T00:00:00.000Z',
  pricePerLiter: 50, volumeLiters: 100, warehouseId: 'w1',
  fulfillment: 'delivery', paymentMode: 'check', status: 'fulfilled',
  installments: amounts.map(([amount, status], i) => ({
    id: `i${i}`, amount, principal: amount, interestPct: 0,
    dueDate: '2026-02-01T00:00:00.000Z', status,
  })),
} as Sale)

describe('bounced checks', () => {
  it('adds up only this customer’s bounced installments', () => {
    const sales = [
      sale('c1', [30_000, 'bounced'], [10_000, 'collected']),
      sale('c1', [5_000, 'bounced']),
      sale('c2', [900_000, 'bounced']),
    ]
    expect(bouncedFor('c1', sales)).toEqual({ count: 2, total: 35_000, step: 0 })
    expect(bouncedFor('c2', sales).total).toBe(900_000)
    expect(bouncedFor('c3', sales)).toEqual({ count: 0, total: 0, step: 0 })
  })

  /** R.A. 10951's brackets: ₱40,000 is the first step up from arresto mayor. */
  it('reads the estafa bracket off the total', () => {
    expect(estafaStep(39_999)).toBe(0)
    expect(estafaStep(40_000)).toBe(0)
    expect(estafaStep(40_001)).toBe(1)
    expect(estafaStep(1_200_001)).toBe(2)
    expect(estafaStep(2_400_001)).toBe(3)
    expect(estafaStep(4_400_001)).toBe(4)
  })

  /** Under the line is still B.P. 22, which has no minimum at all. */
  it('says something for any bounce, and names the line once past it', () => {
    expect(bouncedNote({ count: 0, total: 0, step: 0 })).toBeNull()
    expect(bouncedNote({ count: 1, total: 5_000, step: 0 })).toContain('B.P. 22')
    const big = bouncedNote({ count: 3, total: 500_000, step: 1 })
    expect(big).toContain('40,000')
    expect(big).toContain('estafa')
  })
})
