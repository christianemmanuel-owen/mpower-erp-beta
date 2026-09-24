import { describe, expect, it } from 'vitest'
import { badgeFor, navBadges } from './navBadges'
import type { Delivery, Purchase, Sale } from '../data/types'

/**
 * The sidebar's numbers count only what is late or blocked, on the same
 * predicates the pages use. These pin which path each count lands on and
 * that a module row sums its subpages.
 */
const TODAY = '2026-09-24'
const base = { createdAt: '', updatedAt: '' }
const inst = (status: string, due: string, extra: Record<string, unknown> = {}) =>
  ({ id: `i-${due}-${status}`, principal: 1, interestPct: 0, amount: 1, dueDate: `${due}T00:00:00.000Z`, status, ...extra })
const sale = (status: string, installments: unknown[], id = 's'): Sale => ({
  ...base, id: `${id}-${Math.random()}`, customerId: 'c', agentId: 'a', warehouseId: 'w', productId: 'p', date: '2026-09-01',
  volumeLiters: 1, pricePerLiter: 1, totalAmount: 1, paymentMode: 'check', paymentTerms: 'net30', deliveryMode: 'delivery',
  status, installments,
} as unknown as Sale)

describe('navBadges', () => {
  it('counts overdue collections on Collect, drafts on Sales, and late-to-bank on Treasury', () => {
    const sales = [
      sale('confirmed', [inst('pending', '2026-09-01'), inst('pending', '2026-10-01')]),
      sale('confirmed', [inst('collected', '2026-08-01', { collectedAt: '2026-08-02T00:00:00.000Z', checkDate: '2026-08-20T00:00:00.000Z' })]),
      sale('draft', [inst('pending', '2026-12-01')]),
    ]
    const b = navBadges({ sales }, TODAY)
    expect(b['/collection']).toBe(1)
    expect(b['/treasury']).toBe(1)
    expect(b['/sales']).toBe(1)
  })

  it('counts overdue supplier installments on Payables and late trips on the board', () => {
    const purchases = [{ ...base, id: 'p1', supplierId: 'v', installments: [inst('pending', '2026-09-01'), inst('paid', '2026-09-01'), inst('pending', '2026-10-01')] }] as unknown as Purchase[]
    const deliveries = [
      { ...base, id: 'd1', saleId: 's', scheduleDate: '2026-09-20T00:00:00.000Z', status: 'in_transit' },
      { ...base, id: 'd2', saleId: 's', scheduleDate: '2026-09-20T00:00:00.000Z', status: 'delivered' },
      { ...base, id: 'd3', saleId: 's', scheduleDate: '2026-09-25T00:00:00.000Z', status: 'scheduled' },
    ] as unknown as Delivery[]
    const b = navBadges({ purchases, deliveries }, TODAY)
    expect(b['/treasury/payables']).toBe(1)
    expect(b['/logistics']).toBe(1)
  })

  it('leaves out rows with nothing waiting, and sums a module from its subpages', () => {
    const b = navBadges({ sales: [] }, TODAY)
    expect(b).toEqual({})
    const badges = { '/treasury': 2, '/treasury/payables': 3, '/collection': 1 }
    expect(badgeFor(badges, '/treasury', [{ to: '/treasury' }, { to: '/treasury/clearing' }, { to: '/treasury/payables' }])).toBe(5)
    expect(badgeFor(badges, '/collection')).toBe(1)
    expect(badgeFor(badges, '/sales')).toBe(0)
  })
})
