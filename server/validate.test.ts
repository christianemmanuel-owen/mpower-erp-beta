import { describe, expect, it } from 'vitest'
import { validateRecord } from './validate'

const fields = (tbl: string, body: Record<string, unknown>, mode: 'create' | 'update' = 'create') =>
  validateRecord(tbl, body, mode).map((p) => p.field)

describe('validateRecord', () => {
  it('accepts an ordinary new sale', () => {
    expect(validateRecord('sales', {
      status: 'draft', volumeLiters: 10_000, pricePerLiter: 57,
      installments: [{ principal: 570_000, amount: 570_000 }],
    }, 'create')).toEqual([])
  })

  it('refuses a sale created as fulfilled', () => {
    // The exploit this exists for: such a sale never passed confirm, so it has
    // no delivery trip, yet it counts toward stock, revenue and agent quota.
    expect(fields('sales', { status: 'fulfilled' })).toContain('status')
    expect(fields('sales', { status: 'returned' })).toContain('status')
  })

  it('allows a sale to REACH fulfilled through an update', () => {
    expect(validateRecord('sales', { status: 'fulfilled' }, 'update')).toEqual([])
  })

  it('refuses a status that is not in the union at all', () => {
    expect(fields('sales', { status: 'paid' }, 'update')).toContain('status')
    expect(fields('purchases', { status: 'delivered' }, 'update')).toContain('status')
  })

  it('refuses negative and non-numeric volumes and prices', () => {
    expect(fields('sales', { volumeLiters: -5 })).toContain('volumeLiters')
    expect(fields('sales', { pricePerLiter: 'free' })).toContain('pricePerLiter')
    expect(fields('purchases', { volumeReceived: Number.NaN }, 'update')).toContain('volumeReceived')
    expect(fields('stockThresholds', { thresholdLiters: -1 })).toContain('thresholdLiters')
  })

  it('refuses a negative installment principal', () => {
    expect(fields('sales', { installments: [{ principal: -1 }] })).toContain('installments[0].principal')
  })

  it('refuses installments that are not a list', () => {
    expect(fields('sales', { installments: 'lots' })).toContain('installments')
  })

  it('ignores fields that are absent, so partial updates still work', () => {
    expect(validateRecord('sales', { collectorId: 'p1' }, 'update')).toEqual([])
    expect(validateRecord('sales', {}, 'update')).toEqual([])
  })

  it('has no opinion about tables it does not know', () => {
    expect(validateRecord('announcements', { status: 'anything', volumeLiters: -9 }, 'create')).toEqual([])
  })

  it('accepts zero, which is a real figure for a tanker that arrived empty', () => {
    expect(validateRecord('purchases', { volumeReceived: 0 }, 'update')).toEqual([])
  })
})
