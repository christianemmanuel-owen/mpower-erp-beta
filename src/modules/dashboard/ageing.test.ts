// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { ageingRows } from './ageing'
import type { Sale, SaleInstallment } from '../../data/types'

/**
 * The boundary that matters is between "not yet due" and one day late. An
 * installment due today still has the day to be paid; filing it as overdue
 * would send a collector after someone who is not late.
 *
 * The buckets themselves come from `agingBucketOf` in metrics.ts, shared with
 * the Collections balances report. These tests exist to hold the card to that
 * shared definition - if the two ever diverge again, the same receivable gets
 * two different ages depending which page is open.
 */

const TODAY = '2026-08-26'

const sale = (installments: Partial<SaleInstallment>[], id = 's1'): Sale => ({
  id, customerId: 'c1', agentId: 'a1', date: '2026-06-01T00:00:00.000Z',
  scheduleDate: '2026-06-02T00:00:00.000Z', volumeLiters: 1000, pricePerLiter: 50,
  warehouseId: 'w1', fulfillment: 'delivery', status: 'fulfilled', paymentMode: 'cash',
  installments: installments.map((i, n) => ({
    id: `${id}-i${n}`, amount: 1000, principal: 1000, interestPct: 0,
    dueDate: '2026-08-26T00:00:00.000Z', status: 'pending', ...i,
  })) as SaleInstallment[],
  createdAt: '', updatedAt: '',
} as Sale)

const amountIn = (sales: Sale[], key: string) =>
  ageingRows(sales, TODAY).rows.find((r) => r.key === key)?.amount ?? 0

describe('ageingRows', () => {
  it('treats an installment due today as not yet due', () => {
    const s = [sale([{ dueDate: `${TODAY}T00:00:00.000Z`, amount: 500 }])]
    expect(amountIn(s, 'current')).toBe(500)
    expect(ageingRows(s, TODAY).overdue).toBe(0)
  })

  it('puts one day late in the first overdue bucket', () => {
    const s = [sale([{ dueDate: '2026-08-25T00:00:00.000Z', amount: 500 }])]
    expect(amountIn(s, '1-30')).toBe(500)
    expect(amountIn(s, 'current')).toBe(0)
  })

  it('splits on the same boundaries the balances report uses', () => {
    const s = [sale([
      { dueDate: '2026-07-27T00:00:00.000Z', amount: 100 }, // 30 days
      { dueDate: '2026-07-26T00:00:00.000Z', amount: 200 }, // 31 days
      { dueDate: '2026-06-27T00:00:00.000Z', amount: 400 }, // 60 days
      { dueDate: '2026-06-26T00:00:00.000Z', amount: 800 }, // 61 days
      { dueDate: '2026-05-28T00:00:00.000Z', amount: 1600 }, // 90 days
      { dueDate: '2026-05-27T00:00:00.000Z', amount: 3200 }, // 91 days
    ])]
    expect(amountIn(s, '1-30')).toBe(100)
    expect(amountIn(s, '31-60')).toBe(600)
    expect(amountIn(s, '61-90')).toBe(2400)
    expect(amountIn(s, '90+')).toBe(3200)
  })

  it('ages every bucket the balances report has', () => {
    // Four buckets here against five there meant "over 90 days" was a question
    // Home could not answer and Collections could.
    expect(ageingRows([], TODAY).rows.map((r) => r.key))
      .toEqual(['current', '1-30', '31-60', '61-90', '90+'])
  })

  it('counts only what is still pending', () => {
    const s = [sale([
      { amount: 100, status: 'collected', dueDate: '2026-07-01T00:00:00.000Z' },
      { amount: 200, status: 'pending', dueDate: '2026-07-01T00:00:00.000Z' },
    ])]
    expect(ageingRows(s, TODAY).total).toBe(200)
    expect(ageingRows(s, TODAY).count).toBe(1)
  })

  it('every bucket sums back to the total', () => {
    const s = [sale([
      { amount: 100, dueDate: `${TODAY}T00:00:00.000Z` },
      { amount: 250, dueDate: '2026-08-10T00:00:00.000Z' },
      { amount: 400, dueDate: '2026-07-10T00:00:00.000Z' },
      { amount: 900, dueDate: '2026-05-10T00:00:00.000Z' },
    ])]
    const { rows, total } = ageingRows(s, TODAY)
    expect(rows.reduce((sum, r) => sum + r.amount, 0)).toBe(total)
    expect(total).toBe(1650)
  })

  it('ignores drafts and cancellations, which have nothing to collect', () => {
    const draft = { ...sale([{ amount: 999 }], 's2'), status: 'draft' } as Sale
    expect(ageingRows([draft], TODAY).total).toBe(0)
  })
})
