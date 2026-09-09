import { describe, expect, it } from 'vitest'
import { planReceiptAdjustment } from './receiving'
import type { PurchaseInstallment } from '../data/types'

/**
 * This is money arithmetic that runs unattended on a status flip, so it gets
 * tested hard. The cases that matter are the awkward ones: partly-paid plans,
 * overpayment, rounding drift, and repeated corrections.
 */

const inst = (
  id: string,
  principal: number,
  status: PurchaseInstallment['status'] = 'pending',
  interestPct = 0,
): PurchaseInstallment => ({
  id, principal, interestPct, amount: principal, dueDate: '2026-09-01T00:00:00.000Z', status,
})

/** 10,000 L at ₱57 = ₱570,000. */
const purchase = (installments: PurchaseInstallment[]) => ({
  volumeLiters: 10_000,
  pricePerLiter: 57,
  installments,
})

const principals = (r: { installments: PurchaseInstallment[] }) => r.installments.map((i) => i.principal)

describe('planReceiptAdjustment', () => {
  it('leaves the plan alone when the full order arrives', () => {
    const r = planReceiptAdjustment(purchase([inst('a', 570_000)]), 10_000)
    expect(r.delta).toBe(0)
    expect(r.changed).toBe(false)
    expect(principals(r)).toEqual([570_000])
  })

  it('reduces a single installment to the value of what arrived', () => {
    // 9,650 L × ₱57 = ₱550,050
    const r = planReceiptAdjustment(purchase([inst('a', 570_000)]), 9_650)
    expect(r.receivedTotal).toBe(550_050)
    expect(r.delta).toBe(-19_950)
    expect(principals(r)).toEqual([550_050])
    expect(r.changed).toBe(true)
  })

  it('raises the payable when more arrived than was ordered', () => {
    const r = planReceiptAdjustment(purchase([inst('a', 570_000)]), 10_200)
    expect(r.delta).toBe(11_400)
    expect(principals(r)).toEqual([581_400])
  })

  it('keeps the agreed shape of a split plan', () => {
    // 30/70 split must stay 30/70 after a short delivery.
    const r = planReceiptAdjustment(purchase([inst('a', 171_000), inst('b', 399_000)]), 9_000)
    expect(r.receivedTotal).toBe(513_000)
    expect(principals(r)).toEqual([153_900, 359_100])
    expect(principals(r)[0] / 513_000).toBeCloseTo(0.3, 10)
  })

  it('never rewrites an installment that has already been paid', () => {
    const r = planReceiptAdjustment(
      purchase([inst('a', 285_000, 'paid'), inst('b', 285_000)]),
      9_000,
    )
    // ₱513,000 owed in total, ₱285,000 already gone - ₱228,000 left on the pending row.
    expect(r.paidTotal).toBe(285_000)
    expect(principals(r)).toEqual([285_000, 228_000])
  })

  it('ignores cancelled installments on both sides of the sum', () => {
    const r = planReceiptAdjustment(
      purchase([inst('a', 100_000, 'cancelled'), inst('b', 570_000)]),
      9_000,
    )
    expect(r.paidTotal).toBe(0)
    expect(principals(r)).toEqual([100_000, 513_000])
  })

  it('zeroes the pending rows and reports the excess rather than inventing a refund', () => {
    // ₱500,000 already paid, but only ₱285,000 of fuel arrived.
    const r = planReceiptAdjustment(
      purchase([inst('a', 500_000, 'paid'), inst('b', 70_000)]),
      5_000,
    )
    expect(r.receivedTotal).toBe(285_000)
    expect(r.remainingPayable).toBe(0)
    expect(r.overpaid).toBe(215_000)
    expect(principals(r)).toEqual([500_000, 0])
  })

  it('flags a fully-settled plan as not adjustable instead of silently dropping the difference', () => {
    const r = planReceiptAdjustment(purchase([inst('a', 570_000, 'paid')]), 9_000)
    expect(r.adjustable).toBe(false)
    expect(r.changed).toBe(false)
    expect(principals(r)).toEqual([570_000])
    // The shortfall is still reported so a human can act on it.
    expect(r.overpaid).toBe(57_000)
  })

  it('makes the adjusted plan sum to exactly what is payable, despite rounding', () => {
    // Three equal rows over a total that doesn't divide cleanly by three.
    const r = planReceiptAdjustment(
      { volumeLiters: 10_000, pricePerLiter: 57.005, installments: [inst('a', 190_000), inst('b', 190_000), inst('c', 190_000)] },
      3_333,
    )
    const sum = principals(r).reduce((s, p) => s + p, 0)
    expect(Math.round(sum * 100) / 100).toBe(r.remainingPayable)
  })

  it('recomputes the amount from the new principal, keeping the interest rate', () => {
    const r = planReceiptAdjustment(purchase([inst('a', 570_000, 'pending', 2)]), 9_000)
    expect(r.installments[0].principal).toBe(513_000)
    // 513,000 + 2% financing charge.
    expect(r.installments[0].amount).toBe(523_260)
    expect(r.installments[0].interestPct).toBe(2)
  })

  it('is idempotent - correcting a mistaken receipt restores the original plan', () => {
    const original = [inst('a', 171_000), inst('b', 399_000)]
    const wrong = planReceiptAdjustment(purchase(original), 9_000)
    const corrected = planReceiptAdjustment(purchase(wrong.installments), 10_000)
    expect(principals(corrected)).toEqual([171_000, 399_000])
  })

  it('does not compound when the same short receipt is applied twice', () => {
    const first = planReceiptAdjustment(purchase([inst('a', 570_000)]), 9_000)
    const second = planReceiptAdjustment(purchase(first.installments), 9_000)
    expect(principals(second)).toEqual(principals(first))
  })

  it('splits evenly when there is no shape left to preserve', () => {
    // All pending principals at zero - the weights would be 0/0. An even split
    // is the only sane answer, and NaN in a money field is the failure to avoid.
    const r = planReceiptAdjustment(purchase([inst('a', 0), inst('b', 0)]), 10_000)
    expect(principals(r)).toEqual([285_000, 285_000])
    expect(principals(r).every(Number.isFinite)).toBe(true)
  })

  it('handles a delivery that never turned up', () => {
    const r = planReceiptAdjustment(purchase([inst('a', 570_000)]), 0)
    expect(r.receivedTotal).toBe(0)
    expect(principals(r)).toEqual([0])
    expect(r.overpaid).toBe(0)
  })
})
