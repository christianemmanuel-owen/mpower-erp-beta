import { describe, expect, it } from 'vitest'
import { attentionRows, type AttentionInput } from './attention'
import type { Sale, StockThreshold } from '../../data/types'

/**
 * Needs attention is the only place in the app that reads across every module,
 * so the rule that matters most is the one about what it refuses to read: a
 * caller passes [] for anything the seat cannot see, and no row may appear from
 * an empty collection.
 */

const TODAY = '2026-08-24'

const base = (over: Partial<AttentionInput> = {}): AttentionInput => ({
  sales: [], purchases: [], deliveries: [], customers: [], personnel: [],
  warehouses: [], products: [], stockThresholds: [], approvals: [], today: TODAY, ...over,
})

const sale = (over: Partial<Sale> = {}): Sale => ({
  id: 's1', customerId: 'c1', agentId: 'a1', date: '2026-08-01T00:00:00.000Z',
  scheduleDate: '2026-08-02T00:00:00.000Z', volumeLiters: 20000, pricePerLiter: 56,
  warehouseId: 'w1', fulfillment: 'delivery', status: 'confirmed', paymentMode: 'cash',
  installments: [{ id: 'i1', amount: 1_120_000, principal: 1_120_000, interestPct: 0, dueDate: '2026-08-12T00:00:00.000Z', status: 'pending' }],
  createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', ...over,
} as Sale)

const threshold = (over: Partial<StockThreshold> = {}): StockThreshold => ({
  id: 't1', warehouseId: 'w1', thresholdLiters: 27000, active: true,
  createdAt: TODAY, updatedAt: TODAY, ...over,
} as StockThreshold)

const customer = { id: 'c1', company: 'San Miguel Foods' }
const warehouse = { id: 'w1', name: 'Bulacan depot', capacityLiters: 200000 }

describe('attentionRows', () => {
  it('shows nothing when nothing is wrong', () => {
    expect(attentionRows(base())).toEqual([])
  })

  it('raises an overdue installment against the customer who owes it', () => {
    const rows = attentionRows(base({
      sales: [sale()],
      customers: [customer as never],
    })).filter((r) => r.tag === 'Collect')
    expect(rows).toHaveLength(1)
    expect(rows[0].group).toBe('act')
    expect(rows[0].title).toBe('San Miguel Foods')
    // How long and how much are separate columns, so neither cell mixes them.
    expect(rows[0].age).toBe('12 days over')
    expect(rows[0].value).not.toContain('days over')
  })

  it('does not raise an installment that is merely unpaid', () => {
    const notYetDue = sale({
      installments: [{ id: 'i1', amount: 500, principal: 500, interestPct: 0, dueDate: '2026-12-01T00:00:00.000Z', status: 'pending' }],
    })
    // The same sale still raises a Sales row for having no truck attached -
    // that is a different complaint, and this test is about the money.
    expect(attentionRows(base({ sales: [notYetDue], customers: [customer as never] }))
      .filter((r) => r.tag === 'Collect')).toEqual([])
  })

  it('names the three biggest overdue and summarises the rest', () => {
    const sales = Array.from({ length: 5 }, (_, i) => sale({
      id: `s${i}`,
      installments: [{ id: `i${i}`, amount: (i + 1) * 1000, principal: (i + 1) * 1000, interestPct: 0, dueDate: '2026-08-12T00:00:00.000Z', status: 'pending' }],
    }))
    const rows = attentionRows(base({ sales, customers: [customer as never] }))
    const collect = rows.filter((r) => r.tag === 'Collect')
    expect(collect).toHaveLength(4)
    expect(collect[3].title).toBe('2 more overdue installments')
    // Biggest first, so the summary row is genuinely the smaller remainder.
    expect(collect[0].value).toContain('5,000')
  })

  it('reports a depot under its warning level with the shortfall', () => {
    const rows = attentionRows(base({
      stockThresholds: [threshold()],
      warehouses: [warehouse as never],
    }))
    expect(rows).toHaveLength(1)
    expect(rows[0].group).toBe('act')
    expect(rows[0].title).toBe('Bulacan depot below its warning level')
    expect(rows[0].value).toBe('27,000 L short')
    // A depot is short, not late - the age column stays empty rather than
    // inventing a clock for it.
    expect(rows[0].age).toBe('')
  })

  it('ignores a warning level that has been turned off', () => {
    expect(attentionRows(base({
      stockThresholds: [threshold({ active: false })],
      warehouses: [warehouse as never],
    }))).toEqual([])
  })

  it('links parked approvals to the page that decides them', () => {
    const rows = attentionRows(base({
      approvals: [
        { requestedByName: 'Ramon Cruz', requestedAt: '2026-08-22T00:00:00.000Z', tbl: 'purchases' },
        { requestedByName: 'Ana Lim', requestedAt: '2026-08-23T00:00:00.000Z', tbl: 'sales' },
      ],
    }))
    expect(rows[0].title).toBe('2 inputs parked for your approval')
    // The wait moved out of the prose and into the age column.
    expect(rows[0].age).toBe('2 days waiting')
    expect(rows[0].detail).not.toContain('waiting')
    // The approvals page had no link anywhere in the app before this row.
    expect(rows[0].href).toBe('/settings/approvals')
  })

  it('flags deliveries still sitting at the depot, but not ones already loading', () => {
    const deliveries = [
      { id: 'd1', saleId: 's1', scheduleDate: `${TODAY}T07:00:00.000Z`, status: 'scheduled' },
      { id: 'd2', saleId: 's2', scheduleDate: `${TODAY}T07:00:00.000Z`, status: 'loading' },
      { id: 'd3', saleId: 's3', scheduleDate: `${TODAY}T07:00:00.000Z`, status: 'delivered' },
    ]
    const rows = attentionRows(base({ deliveries: deliveries as never }))
    const trips = rows.find((r) => r.tag === 'Trips')
    expect(trips?.title).toBe('1 of 3 deliveries not yet loaded')
    expect(trips?.group).toBe('today')
  })

  it('flags a confirmed sale that nobody has scheduled a truck for', () => {
    const rows = attentionRows(base({ sales: [sale({ installments: [] })] }))
    const unplanned = rows.find((r) => r.tag === 'Sales')
    expect(unplanned?.title).toBe('1 confirmed sale with no delivery scheduled')
    expect(unplanned?.value).toBe('20,000 L')
  })

  it('does not flag a confirmed sale that already has a delivery', () => {
    const rows = attentionRows(base({
      sales: [sale({ installments: [] })],
      deliveries: [{ id: 'd1', saleId: 's1', scheduleDate: '2026-08-02T00:00:00.000Z', status: 'scheduled' }] as never,
    }))
    expect(rows.find((r) => r.tag === 'Sales')).toBeUndefined()
  })

  it('shows no money to a seat whose sales collection came in empty', () => {
    // The module filter happens at the call site, so an excluded seat is
    // modelled exactly as the Dashboard models it: an empty array.
    const rows = attentionRows(base({
      sales: [],
      customers: [customer as never],
      stockThresholds: [threshold()],
      warehouses: [warehouse as never],
    }))
    expect(rows.every((r) => r.tag === 'Stock')).toBe(true)
  })
})
