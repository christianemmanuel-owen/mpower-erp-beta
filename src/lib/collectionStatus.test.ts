import { describe, expect, it } from 'vitest'
import {
  isInClearing, isInHand, isOutstanding, isSettled, wasCollected,
} from './collectionStatus'
import { depositedItems, itemsInClearing, undepositedItems, unsettledReceivables, openReceivables, depositOverdue } from './metrics'
import type { CollectionStatus, Sale, SaleInstallment } from '../data/types'

const inst = (over: Partial<SaleInstallment>): SaleInstallment => ({
  id: over.id ?? 'i1', amount: 100, principal: 100, interestPct: 0,
  dueDate: '2026-02-02T00:00:00.000Z', status: 'pending', ...over,
})

const sale = (installments: SaleInstallment[]): Sale => ({
  id: 's1', createdAt: '', updatedAt: '', agentId: 'a1', customerId: 'c1',
  date: '2026-01-02T00:00:00.000Z', pricePerLiter: 55, volumeLiters: 1000,
  warehouseId: 'w1', fulfillment: 'delivery', paymentMode: 'check', status: 'fulfilled',
  installments,
} as unknown as Sale)

describe('what each state means', () => {
  /**
   * The distinction the client asked for, as a table. A check in hand is not
   * deposited, a deposited check is not money, and only cleared money settles
   * anything - but the collector's part is done at the first of the three.
   */
  const table: Array<[CollectionStatus, { inHand: boolean; clearing: boolean; settled: boolean; collected: boolean; outstanding: boolean }]> = [
    ['pending', { inHand: false, clearing: false, settled: false, collected: false, outstanding: true }],
    ['collected', { inHand: true, clearing: false, settled: false, collected: true, outstanding: true }],
    ['deposited', { inHand: false, clearing: true, settled: false, collected: true, outstanding: true }],
    ['cleared', { inHand: false, clearing: false, settled: true, collected: true, outstanding: false }],
    ['bounced', { inHand: false, clearing: false, settled: false, collected: false, outstanding: false }],
    ['cancelled', { inHand: false, clearing: false, settled: false, collected: false, outstanding: false }],
  ]

  for (const [status, want] of table) {
    it(`reads ${status} correctly`, () => {
      expect(isInHand(status)).toBe(want.inHand)
      expect(isInClearing(status)).toBe(want.clearing)
      expect(isSettled(status)).toBe(want.settled)
      expect(wasCollected(status)).toBe(want.collected)
      expect(isOutstanding(status)).toBe(want.outstanding)
    })
  }
})

describe('which queue each payment lands in', () => {
  const sales = [sale([
    inst({ id: 'due', status: 'pending' }),
    inst({ id: 'hand', status: 'collected', collectedAt: '2026-02-01T00:00:00.000Z', checkDate: '2026-02-20T00:00:00.000Z' }),
    inst({ id: 'bank', status: 'deposited', collectedAt: '2026-02-01T00:00:00.000Z', depositedAt: '2026-02-03T00:00:00.000Z' }),
    inst({ id: 'done', status: 'cleared', collectedAt: '2026-02-01T00:00:00.000Z', clearedAt: '2026-02-05T00:00:00.000Z' }),
  ])]

  const ids = (rows: { installment: SaleInstallment }[]) => rows.map((r) => r.installment.id)

  /**
   * The collector is not chased about a check already in the office safe -
   * their part finished when they brought it in.
   */
  it('leaves the collector only what nobody has gone and got', () => {
    expect(ids(openReceivables(sales))).toEqual(['due'])
  })

  it('keeps everything not yet cleared on the customer’s balance', () => {
    expect(ids(unsettledReceivables(sales))).toEqual(['due', 'hand', 'bank'])
  })

  it('hands the in-hand items to Treasury and nothing else', () => {
    expect(ids(undepositedItems(sales))).toEqual(['hand'])
    expect(ids(itemsInClearing(sales))).toEqual(['bank'])
  })

  /** The Deposited history: everything that reached the bank, newest first,
   *  whatever the bank then said - and never a record that has no deposit
   *  date, however it was closed. */
  it('lists what has been banked, newest first, whatever the bank said', () => {
    const banked = [sale([
      inst({ id: 'old', status: 'cleared', depositedAt: '2026-02-01T00:00:00.000Z', clearedAt: '2026-02-03T00:00:00.000Z' }),
      inst({ id: 'new', status: 'deposited', depositedAt: '2026-02-09T00:00:00.000Z' }),
      inst({ id: 'nsf', status: 'bounced', depositedAt: '2026-02-05T00:00:00.000Z' }),
      inst({ id: 'cash', status: 'cleared', clearedAt: '2026-02-05T00:00:00.000Z' }),
      inst({ id: 'hand', status: 'collected' }),
    ])]
    expect(ids(depositedItems(banked))).toEqual(['new', 'nsf', 'old'])
  })

  /**
   * The case that prompted the whole change: a post-dated check collected
   * early is queued by the date on its face, not the day it arrived, because
   * the bank will not take it before then.
   */
  it('queues a deposit by the check’s own date, not the collection date', () => {
    const [row] = undepositedItems(sales)
    expect(row.depositDue).toBe('2026-02-20T00:00:00.000Z')
    expect(depositOverdue(row.depositDue, Date.parse('2026-02-10'))).toBe(false)
    expect(depositOverdue(row.depositDue, Date.parse('2026-02-21'))).toBe(true)
  })

  it('falls back to the collection date when there is no check', () => {
    const cash = [sale([inst({ id: 'cash', status: 'collected', collectedAt: '2026-03-01T00:00:00.000Z' })])]
    expect(undepositedItems(cash)[0].depositDue).toBe('2026-03-01T00:00:00.000Z')
  })
})
