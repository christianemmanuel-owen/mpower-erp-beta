import { describe, expect, it } from 'vitest'
import { defaultTreatment, planResolution, planRevertResolution, treatmentsFor } from './orderResolution'
import { netSaleVolume, restockedVolume, saleCounts } from './metrics'
import type { Sale, SaleInstallment } from '../data/types'

const inst = (
  id: string,
  amount: number,
  status: SaleInstallment['status'] = 'pending',
): SaleInstallment => ({
  id, amount, principal: amount, interestPct: 0, dueDate: '2026-09-01T00:00:00.000Z', status,
})

const sale = (over: Partial<Sale> = {}): Sale => ({
  id: 's1',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  agentId: 'a1',
  customerId: 'c1',
  date: '2026-08-01T00:00:00.000Z',
  pricePerLiter: 62,
  volumeLiters: 5_000,
  warehouseId: 'w1',
  fulfillment: 'delivery',
  paymentMode: 'bank_transfer',
  installments: [inst('i1', 310_000)],
  status: 'confirmed',
  ...over,
})

const RESOLVED_ON = '2026-08-21T00:00:00.000Z'

describe('treatment options', () => {
  it('asks only about the money - the fuel is a separate question', () => {
    // "Restocked" and "written off" were fuel answers living in a money field.
    // Neither is offered any more; the fuel is `backToStock`.
    for (const kind of ['cancelled', 'returned'] as const) {
      const values = treatmentsFor(kind).map((t) => t.value)
      expect(values).not.toContain('restocked')
      expect(values).not.toContain('written_off')
      expect(values).toContain('no_action')
      expect(values).toContain('refunded')
      expect(values).toContain('credit_note')
    }
  })

  it('offers a replacement only for a return', () => {
    expect(treatmentsFor('cancelled').map((t) => t.value)).not.toContain('replaced')
    expect(treatmentsFor('returned').map((t) => t.value)).toContain('replaced')
  })

  it('defaults to nothing collected - the order reversed before money moved', () => {
    expect(defaultTreatment('cancelled')).toBe('no_action')
    expect(defaultTreatment('returned')).toBe('no_action')
  })
})

describe('planResolution', () => {
  it('records reason and treatment against the order', () => {
    const plan = planResolution(sale(), {
      kind: 'cancelled', reason: 'Customer changed their mind', treatment: 'no_action', date: RESOLVED_ON,
    })
    expect(plan.patch.status).toBe('cancelled')
    expect(plan.patch.resolution?.reason).toBe('Customer changed their mind')
    expect(plan.patch.resolution?.treatment).toBe('no_action')
  })

  it('stops the order consuming stock once cancelled', () => {
    const plan = planResolution(sale(), {
      kind: 'cancelled', reason: 'Duplicate order', treatment: 'no_action', date: RESOLVED_ON,
    })
    const after = { ...sale(), ...plan.patch } as Sale
    expect(saleCounts(after)).toBe(false)
  })

  it('cancels the pending installments - nothing is owed on a called-off order', () => {
    const plan = planResolution(
      sale({ installments: [inst('i1', 150_000), inst('i2', 160_000)] }),
      { kind: 'cancelled', reason: 'Customer withdrew', treatment: 'no_action', date: RESOLVED_ON },
    )
    expect(plan.patch.installments?.every((i) => i.status === 'cancelled')).toBe(true)
    expect(plan.cancelledInstallments).toBe(2)
  })

  it('never un-collects money that has already arrived', () => {
    // Reversing a collected payment would be a refund the System invented.
    const plan = planResolution(
      sale({ installments: [inst('i1', 150_000, 'collected'), inst('i2', 160_000)] }),
      { kind: 'returned', reason: 'Off-spec fuel', treatment: 'refunded', date: RESOLVED_ON },
    )
    expect(plan.patch.installments?.[0].status).toBe('collected')
    expect(plan.patch.installments?.[1].status).toBe('cancelled')
    expect(plan.collectedAmount).toBe(150_000)
    expect(plan.cancelledInstallments).toBe(1)
  })

  it('puts a return back into stock when the fuel came back, whatever the money', () => {
    const plan = planResolution(sale(), {
      kind: 'returned', reason: 'Wrong depot', treatment: 'refunded', backToStock: true, date: RESOLVED_ON,
    })
    expect(plan.restockedVolume).toBe(5_000)
    expect(plan.returnedVolume).toBe(5_000)
    const after = { ...sale(), ...plan.patch } as Sale
    expect(restockedVolume(after)).toBe(5_000)
  })

  it('restocks only the returned portion of a partial return', () => {
    const plan = planResolution(sale(), {
      kind: 'returned', reason: 'Short-filled', treatment: 'no_action', backToStock: true, volumeReturned: 1_200, date: RESOLVED_ON,
    })
    expect(plan.restockedVolume).toBe(1_200)
    expect(plan.returnedVolume).toBe(1_200)
    const after = { ...sale(), ...plan.patch } as Sale
    expect(restockedVolume(after)).toBe(1_200)
  })

  it('never restocks more than was sold, however the form is filled in', () => {
    const plan = planResolution(sale(), {
      kind: 'returned', reason: 'Typo', treatment: 'no_action', backToStock: true, volumeReturned: 999_999, date: RESOLVED_ON,
    })
    expect(plan.restockedVolume).toBe(5_000)
  })

  it('returns nothing to stock when the fuel did not come back - but the sale still comes off', () => {
    const plan = planResolution(sale(), {
      kind: 'returned', reason: 'Contaminated', treatment: 'refunded', backToStock: false, date: RESOLVED_ON,
    })
    expect(plan.restockedVolume).toBe(0)
    expect(plan.returnedVolume).toBe(5_000)
    const after = { ...sale(), ...plan.patch } as Sale
    expect(restockedVolume(after)).toBe(0)
    expect(netSaleVolume(after)).toBe(0)
    expect(after.resolution?.backToStock).toBe(false)
  })

  it('returns nothing to stock for a cancellation, even if volume is passed', () => {
    // A cancelled order never consumed stock, so "putting it back" would create
    // fuel out of nothing.
    const plan = planResolution(sale(), {
      kind: 'cancelled', reason: 'Called off', treatment: 'refunded', volumeReturned: 5_000, date: RESOLVED_ON,
    })
    expect(plan.restockedVolume).toBe(0)
  })

  it('remembers where the order came from so it can be put back', () => {
    const plan = planResolution(sale({ status: 'fulfilled' }), {
      kind: 'returned', reason: 'Rejected on arrival', treatment: 'no_action', date: RESOLVED_ON,
    })
    expect(plan.patch.resolution?.previousStatus).toBe('fulfilled')
  })

  it('trims the reason so a stray space is not stored as one', () => {
    const plan = planResolution(sale(), {
      kind: 'cancelled', reason: '  Customer withdrew  ', treatment: 'no_action', date: RESOLVED_ON,
    })
    expect(plan.patch.resolution?.reason).toBe('Customer withdrew')
  })
})

describe('planRevertResolution', () => {
  it('puts the order back to the status it held before', () => {
    const resolved = { ...sale({ status: 'fulfilled' }) }
    const plan = planResolution(resolved, {
      kind: 'returned', reason: 'Mis-click', treatment: 'restocked', date: RESOLVED_ON,
    })
    const after = { ...resolved, ...plan.patch } as Sale
    expect(planRevertResolution(after).status).toBe('fulfilled')
  })

  it('makes the cancelled installments payable again', () => {
    const original = sale({ installments: [inst('i1', 150_000), inst('i2', 160_000)] })
    const plan = planResolution(original, {
      kind: 'cancelled', reason: 'Mis-click', treatment: 'no_action', date: RESOLVED_ON,
    })
    const after = { ...original, ...plan.patch } as Sale
    const reverted = planRevertResolution(after)
    expect(reverted.installments?.every((i) => i.status === 'pending')).toBe(true)
    expect(reverted.resolution).toBeUndefined()
  })

  it('leaves collected installments collected when reverting', () => {
    const original = sale({ installments: [inst('i1', 150_000, 'collected'), inst('i2', 160_000)] })
    const plan = planResolution(original, {
      kind: 'returned', reason: 'Mis-click', treatment: 'refunded', date: RESOLVED_ON,
    })
    const after = { ...original, ...plan.patch } as Sale
    const reverted = planRevertResolution(after)
    expect(reverted.installments?.[0].status).toBe('collected')
    expect(reverted.installments?.[1].status).toBe('pending')
  })

  it('falls back to confirmed for a record written before previousStatus existed', () => {
    const legacy = sale({
      status: 'cancelled',
      resolution: { date: RESOLVED_ON, reason: 'Old record', treatment: 'no_action' },
    })
    expect(planRevertResolution(legacy).status).toBe('confirmed')
  })

  it('round-trips a cancel then revert back to the original order', () => {
    const original = sale({ status: 'confirmed', installments: [inst('i1', 310_000)] })
    const plan = planResolution(original, {
      kind: 'cancelled', reason: 'Wrong customer', treatment: 'no_action', date: RESOLVED_ON,
    })
    const cancelled = { ...original, ...plan.patch } as Sale
    const restored = { ...cancelled, ...planRevertResolution(cancelled) } as Sale
    expect(restored.status).toBe(original.status)
    expect(restored.installments).toEqual(original.installments)
    expect(saleCounts(restored)).toBe(true)
  })
})
