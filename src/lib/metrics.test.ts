import { describe, expect, it } from 'vitest'
import {
  agentStats, agingBucketOf, collectorWorkload, customerStats, flowSeries, inRange,
  installmentBankAccount, installmentCollector, isInstallmentOverdue, openReceivables,
  outstandingByCustomer, recentActivity, revenue, stockByWarehouse, stockSeries, supplierStats,
  stockSaleVolume, volumeIn, volumeOut,
} from './metrics'
import type { Agent, Customer, Delivery, Purchase, Sale, SaleInstallment, Supplier, SupplierQuote } from '../data/types'

const base = { id: 'x', createdAt: '', updatedAt: '' }

function purchase(p: Partial<Purchase>): Purchase {
  return {
    ...base, supplierId: 's1', date: '2026-07-01', pricePerLiter: 52, volumeLiters: 10000,
    fulfillment: 'delivered', warehouseId: 'w1', status: 'received',
    paymentMode: 'bank_transfer',
    installments: [{ id: 'i1', amount: 10000 * 52, principal: 10000 * 52, interestPct: 0, dueDate: '2026-07-01', status: 'paid' }],
    ...p,
  } as Purchase
}

function sale(s: Partial<Sale>): Sale {
  return {
    ...base, agentId: 'a1', customerId: 'c1', date: '2026-07-02', pricePerLiter: 58,
    volumeLiters: 4000, warehouseId: 'w1', fulfillment: 'delivery', paymentMode: 'cash',
    installments: [{ id: 'i1', amount: 4000 * 58, principal: 4000 * 58, interestPct: 0, dueDate: '2026-07-02', status: 'collected' }],
    status: 'fulfilled', ...s,
  } as Sale
}

function delivery(d: Partial<Delivery>): Delivery {
  return {
    ...base, saleId: 'x', scheduleDate: '2026-07-02', deliveryAddress: '', contactPerson: '',
    contactNumber: '', status: 'delivered', ...d,
  } as Delivery
}

const range = { from: '2026-07-01', to: '2026-07-31' }

describe('inRange', () => {
  it('includes boundaries', () => {
    expect(inRange('2026-07-01T05:00:00Z', range)).toBe(true)
    expect(inRange('2026-07-31', range)).toBe(true)
    expect(inRange('2026-06-30', range)).toBe(false)
    expect(inRange('2026-08-01', range)).toBe(false)
  })
})

describe('isInstallmentOverdue', () => {
  const past = new Date(Date.now() - 5 * 86_400_000).toISOString()
  const future = new Date(Date.now() + 5 * 86_400_000).toISOString()

  it('is overdue only when pending and its due date has passed - same shape works for either a sale or purchase installment', () => {
    expect(isInstallmentOverdue({ status: 'pending', dueDate: past })).toBe(true)
    expect(isInstallmentOverdue({ status: 'pending', dueDate: future })).toBe(false)
    expect(isInstallmentOverdue({ status: 'collected', dueDate: past })).toBe(false)
    expect(isInstallmentOverdue({ status: 'paid', dueDate: past })).toBe(false)
    expect(isInstallmentOverdue({ status: 'cancelled', dueDate: past })).toBe(false)
  })
})

describe('stockByWarehouse', () => {
  it('adds received purchases, subtracts non-draft sales', () => {
    const stock = stockByWarehouse(
      [purchase({ volumeLiters: 20000 }), purchase({ volumeLiters: 5000, status: 'ordered' })],
      [sale({ volumeLiters: 6000 }), sale({ volumeLiters: 1000, status: 'draft' })],
    )
    expect(stock.get('w1')).toBe(14000)
  })

  it('tracks warehouses independently', () => {
    const stock = stockByWarehouse(
      [purchase({ warehouseId: 'w1' }), purchase({ warehouseId: 'w2', volumeLiters: 3000 })],
      [sale({ warehouseId: 'w2', volumeLiters: 500 })],
    )
    expect(stock.get('w1')).toBe(10000)
    expect(stock.get('w2')).toBe(2500)
  })
})

describe('interval totals', () => {
  const purchases = [
    purchase({ date: '2026-07-05', volumeLiters: 10000 }),
    purchase({ date: '2026-06-05', volumeLiters: 99999 }),
    purchase({ date: '2026-07-06', volumeLiters: 5000, status: 'ordered' }),
  ]
  const sales = [
    sale({ date: '2026-07-10', volumeLiters: 3000 }),
    sale({ date: '2026-05-10', volumeLiters: 99999 }),
    sale({ date: '2026-07-11', volumeLiters: 700, status: 'draft' }),
  ]

  it('volumeIn counts only received purchases in range', () => {
    expect(volumeIn(purchases, range)).toBe(10000)
  })

  it('volumeOut excludes drafts and out-of-range', () => {
    expect(volumeOut(sales, range)).toBe(3000)
  })

  it('revenue multiplies volume by price', () => {
    expect(revenue(sales, range)).toBe(3000 * 58)
  })
})

describe('customerStats', () => {
  const cust: Customer = {
    ...base, id: 'c1', company: 'Kargamento', brand: 'K', address: '', contactPerson: '',
    contactNumber: '', customerSince: new Date(Date.now() - 3 * 365.25 * 86_400_000).toISOString(),
    paymentTermDays: 30,
  }
  const sales = [
    sale({
      customerId: 'c1', date: '2026-07-01', volumeLiters: 4000, pricePerLiter: 58, paymentMode: 'check',
      installments: [{ id: 'i1', amount: 4000 * 58, principal: 4000 * 58, interestPct: 0, dueDate: '2026-07-01', status: 'collected' }],
    }),
    sale({
      customerId: 'c1', date: '2026-07-11', volumeLiters: 8000, pricePerLiter: 60, paymentMode: 'check',
      installments: [{ id: 'i2', amount: 8000 * 60, principal: 8000 * 60, interestPct: 0, dueDate: '2026-07-11', status: 'collected' }],
    }),
    sale({
      customerId: 'c1', date: '2026-06-21', volumeLiters: 6000, pricePerLiter: 59, paymentMode: 'cash',
      installments: [{
        id: 'i3', amount: 6000 * 59, principal: 6000 * 59, interestPct: 0,
        dueDate: new Date(Date.now() - 30 * 86_400_000).toISOString(), status: 'pending',
      }],
    }),
    sale({
      customerId: 'c1', date: '2026-07-05', volumeLiters: 1000, status: 'draft',
      installments: [{ id: 'i4', amount: 1000 * 58, principal: 1000 * 58, interestPct: 0, dueDate: '2026-07-05', status: 'pending' }],
    }),
  ]

  it('computes order behavior from non-draft sales', () => {
    const [s] = customerStats([cust], sales, range, 52)
    expect(s.orderCount).toBe(3)
    expect(s.avgOrderLiters).toBe(6000)
    expect(s.reorderDays).toBe(10) // 20-day span / 2 intervals
    expect(s.usualPayment).toBe('check')
    expect(s.yearsWith).toBeCloseTo(3, 0)
  })

  it('scopes net order to the range and derives markup', () => {
    const [s] = customerStats([cust], sales, range, 52)
    expect(s.netVolume).toBe(12000) // July orders only
    expect(s.netAmount).toBe(4000 * 58 + 8000 * 60)
    const avgPrice = (4000 * 58 + 8000 * 60 + 6000 * 59) / 18000
    expect(s.markup).toBeCloseTo(avgPrice - 52, 5)
  })

  it('rates credit from collection outcomes', () => {
    const [s] = customerStats([cust], sales, range, null)
    expect(s.onTimeRate).toBeCloseTo(2 / 3, 5)
    expect(s.overdueCount).toBe(1)
    expect(s.rating).toBe('watch') // overdue exists but on-time ≥ 0.7 fails 'poor', < excellent thresholds
    const clean = customerStats([cust], sales.map((x) => ({
      ...x, installments: x.installments.map((i) => ({ ...i, status: 'collected' as const })),
    })), range, null)
    expect(clean[0].rating).toBe('excellent')
  })
})

describe('supplierStats', () => {
  const sup = (id: string, name: string): Supplier => ({ ...base, id, name, contactPerson: '', contactNumber: '', address: '', paymentTermDays: 30 })
  const quote = (supplierId: string, date: string, price: number): SupplierQuote => ({ ...base, supplierId, date, pricePerLiter: price })
  const suppliers = [sup('s1', 'Petron'), sup('s2', 'Shell')]
  const purchases = [
    purchase({ supplierId: 's1', date: '2026-07-01', volumeLiters: 20000, pricePerLiter: 52 }),
    purchase({ supplierId: 's1', date: '2026-07-08', volumeLiters: 10000, pricePerLiter: 53 }),
    purchase({ supplierId: 's2', date: '2026-07-03', volumeLiters: 10000, pricePerLiter: 54 }),
    purchase({ supplierId: 's2', date: '2026-06-01', volumeLiters: 99000, pricePerLiter: 54 }), // out of range
  ]
  const quotes = [
    quote('s1', '2026-07-01', 52.5), quote('s1', '2026-07-08', 53.5),
    quote('s2', '2026-07-01', 54.2), quote('s2', '2026-08-01', 55),
  ]

  it('ranks by spend within range with share of total', () => {
    const stats = supplierStats(suppliers, purchases, quotes, range)
    expect(stats[0].supplier.id).toBe('s1')
    expect(stats[0].totalSpend).toBe(20000 * 52 + 10000 * 53)
    expect(stats[0].rank).toBe(1)
    expect(stats[0].share + stats[1].share).toBeCloseTo(1, 5)
  })

  it('aggregates quotes and finds the latest overall', () => {
    const stats = supplierStats(suppliers, purchases, quotes, range)
    const shell = stats.find((s) => s.supplier.id === 's2')!
    expect(shell.avgQuoted).toBeCloseTo(54.2, 5) // only the in-range quote
    expect(shell.lastQuote?.pricePerLiter).toBe(55) // latest regardless of range
    expect(shell.avgPaid).toBeCloseTo(54, 5)
  })

  it('excludes purchases still awaiting receipt - matches the price chart, which only plots received dots', () => {
    const ordered = [
      purchase({ supplierId: 's1', date: '2026-07-15', volumeLiters: 30000, pricePerLiter: 999, status: 'ordered' }),
    ]
    const stats = supplierStats(suppliers, [...purchases, ...ordered], quotes, range)
    const petron = stats.find((s) => s.supplier.id === 's1')!
    // Same totals as the base test - the 'ordered' purchase must not move spend/volume/avgPaid.
    expect(petron.totalSpend).toBe(20000 * 52 + 10000 * 53)
    expect(petron.totalVolume).toBe(30000)
    expect(petron.purchaseCount).toBe(2)
  })
})

describe('agentStats', () => {
  const agents: Agent[] = [
    { ...base, id: 'a1', name: 'Ramon', contactNumber: '', monthlyQuotaLiters: 10000 },
    { ...base, id: 'a2', name: 'Jenny', contactNumber: '', monthlyQuotaLiters: 10000 },
  ]
  const sales = [
    sale({ agentId: 'a1', volumeLiters: 8000 }),
    sale({ agentId: 'a2', volumeLiters: 2000 }),
    sale({ agentId: 'a2', volumeLiters: 1000, status: 'draft' }),
  ]

  it('ranks by volume and computes quota progress', () => {
    const stats = agentStats(agents, sales, range)
    expect(stats[0].agent.id).toBe('a1')
    expect(stats[0].rank).toBe(1)
    expect(stats[1].agent.id).toBe('a2')
    expect(stats[1].volume).toBe(2000)
    // 31-day range ≈ 1.03 months of quota
    expect(stats[0].quotaProgress).toBeGreaterThan(0.7)
    expect(stats[0].quotaProgress).toBeLessThan(0.85)
  })
})

describe('stockSeries', () => {
  it('runs a cumulative balance per warehouse up to each sample date', () => {
    const purchases = [
      purchase({ warehouseId: 'w1', date: '2026-07-01', volumeLiters: 10000 }),
      purchase({ warehouseId: 'w1', date: '2026-07-20', volumeLiters: 5000 }),
      purchase({ warehouseId: 'w1', date: '2026-07-10', volumeLiters: 9999, status: 'ordered' }), // ignored
    ]
    const sales = [
      sale({ warehouseId: 'w1', date: '2026-07-15', volumeLiters: 3000 }),
      sale({ warehouseId: 'w1', date: '2026-07-25', volumeLiters: 1000, status: 'draft' }), // ignored
    ]
    const series = stockSeries(purchases, sales, ['w1'], range, 4) // 4 samples: Jul 1, 11, 21, 31
    expect(series).toHaveLength(4)
    expect(series[0].values.w1).toBe(10000) // just the Jul 1 purchase
    expect(series[1].values.w1).toBe(10000) // Jul 11: still before the Jul 15 sale
    expect(series[2].values.w1).toBe(12000) // Jul 21: +10000 -3000 +5000
    expect(series[3].values.w1).toBe(12000) // Jul 31: draft sale doesn't count
  })

  it('tracks warehouses independently and defaults unmentioned ones to zero', () => {
    const series = stockSeries(
      [purchase({ warehouseId: 'w1', volumeLiters: 8000 })],
      [],
      ['w1', 'w2'],
      range,
      2,
    )
    expect(series[1].values.w1).toBe(8000)
    expect(series[1].values.w2).toBe(0)
  })
})

describe('flowSeries', () => {
  it('buckets bought and sold volume separately per day', () => {
    const purchases = [
      purchase({ date: '2026-07-01', volumeLiters: 10000 }),
      purchase({ date: '2026-07-01', volumeLiters: 2000, status: 'ordered' }), // ignored
      purchase({ date: '2026-06-01', volumeLiters: 99999 }), // out of range
    ]
    const sales = [
      sale({ date: '2026-07-01', volumeLiters: 4000 }),
      sale({ date: '2026-07-01', volumeLiters: 1000, status: 'draft' }), // ignored
    ]
    const flow = flowSeries(purchases, sales, range)
    expect(flow[0].bought).toBe(10000)
    expect(flow[0].sold).toBe(4000)
    const totalBought = flow.reduce((sum, f) => sum + f.bought, 0)
    const totalSold = flow.reduce((sum, f) => sum + f.sold, 0)
    expect(totalBought).toBe(10000)
    expect(totalSold).toBe(4000)
  })
})

describe('recentActivity', () => {
  it('merges purchases, non-draft sales, and deliveries, newest first', () => {
    const purchases = [purchase({ id: 'p1', date: '2026-07-01' })]
    const sales = [
      sale({ id: 's1', date: '2026-07-10' }),
      sale({ id: 's2', date: '2026-07-20', status: 'draft' }), // excluded
    ]
    const deliveries = [delivery({ id: 'd1', scheduleDate: '2026-07-15' })]
    const events = recentActivity(purchases, sales, deliveries, 10)
    // Newest first: d1 (Jul 15) > s1 (Jul 10) > p1 (Jul 1). s2 (Jul 20) is draft, excluded entirely.
    expect(events.map((e) => e.id)).toEqual(['d1', 's1', 'p1'])
    expect(events.find((e) => e.id === 's2')).toBeUndefined()
  })

  it('caps results at limit', () => {
    const purchases = Array.from({ length: 5 }, (_, i) => purchase({ id: `p${i}`, date: `2026-07-0${i + 1}` }))
    expect(recentActivity(purchases, [], [], 3)).toHaveLength(3)
  })
})

// ---- Collection -------------------------------------------------------------

function inst(i: Partial<SaleInstallment>): SaleInstallment {
  return { id: 'i1', amount: 1000, principal: 1000, interestPct: 0, dueDate: '2026-07-10', status: 'pending', ...i }
}

const TODAY = '2026-07-21'

describe('collector / bank account resolution', () => {
  it('installment override wins, else sale default, else null', () => {
    const s = sale({ collectorId: 'p-sale', bankAccountId: 'b-sale' })
    expect(installmentCollector(s, inst({ collectorId: 'p-own' }))).toBe('p-own')
    expect(installmentCollector(s, inst({}))).toBe('p-sale')
    expect(installmentCollector(sale({}), inst({}))).toBeNull()
    expect(installmentBankAccount(s, inst({ bankAccountId: 'b-own' }))).toBe('b-own')
    expect(installmentBankAccount(s, inst({}))).toBe('b-sale')
    expect(installmentBankAccount(sale({ bankAccountId: undefined }), inst({}))).toBeNull()
  })
})

describe('openReceivables', () => {
  it('keeps only pending installments of non-draft sales', () => {
    const sales = [
      sale({ id: 's1', installments: [inst({ id: 'a' }), inst({ id: 'b', status: 'collected' }), inst({ id: 'c', status: 'cancelled' })] }),
      sale({ id: 's2', status: 'draft', installments: [inst({ id: 'd' })] }),
      sale({ id: 's3', status: 'confirmed', installments: [inst({ id: 'e' })] }),
    ]
    expect(openReceivables(sales).map((e) => e.installment.id)).toEqual(['a', 'e'])
  })
})

describe('agingBucketOf', () => {
  it('buckets by whole days past due, boundaries inclusive', () => {
    expect(agingBucketOf('2026-07-22', TODAY)).toBe('current') // due tomorrow
    expect(agingBucketOf('2026-07-21', TODAY)).toBe('current') // due today
    expect(agingBucketOf('2026-07-20', TODAY)).toBe('1-30') // 1 day
    expect(agingBucketOf('2026-06-21', TODAY)).toBe('1-30') // 30 days
    expect(agingBucketOf('2026-06-20', TODAY)).toBe('31-60') // 31 days
    expect(agingBucketOf('2026-05-22', TODAY)).toBe('31-60') // 60 days
    expect(agingBucketOf('2026-05-21', TODAY)).toBe('61-90') // 61 days
    expect(agingBucketOf('2026-04-22', TODAY)).toBe('61-90') // 90 days
    expect(agingBucketOf('2026-04-21', TODAY)).toBe('90+') // 91 days
  })
})

describe('outstandingByCustomer', () => {
  /**
   * A collected check is still owed until it clears - the bank can refuse it -
   * so it stays on the balance as money in flight. It is not late, though, so
   * it sits in no ageing bucket and does not move the next due date.
   */
  it('aggregates what each customer owes, ageing only what is still to collect', () => {
    const sales = [
      sale({ id: 's1', customerId: 'c1', collectorId: 'p1', installments: [
        inst({ id: 'a', amount: 500, dueDate: '2026-08-01' }), // current
        inst({ id: 'b', amount: 300, dueDate: '2026-07-01' }), // 20 days overdue
        inst({ id: 'c', amount: 999, dueDate: '2026-01-01', status: 'collected' }), // in hand: owed, not late
        inst({ id: 'e', amount: 111, dueDate: '2026-01-01', status: 'cleared' }), // paid: gone
      ] }),
      sale({ id: 's2', customerId: 'c2', installments: [inst({ id: 'd', amount: 200, dueDate: '2026-03-01', collectorId: 'p2' })] }),
    ]
    const [c1, c2] = outstandingByCustomer(sales, TODAY)
    expect(c1.customerId).toBe('c1') // biggest outstanding first
    expect(c1.outstanding).toBe(1799)
    expect(c1.inFlight).toBe(999)
    expect(c1.openCount).toBe(2)
    expect(c1.overdue).toBe(300)
    expect(c1.aging).toEqual({ 'current': 500, '1-30': 300, '31-60': 0, '61-90': 0, '90+': 0 })
    expect(c1.nextDue).toBe('2026-07-01')
    expect(c1.collectorIds).toEqual(['p1'])
    expect(c2.outstanding).toBe(200)
    expect(c2.aging['90+']).toBe(200)
    expect(c2.collectorIds).toEqual(['p2'])
  })

  it('omits customers who owe nothing', () => {
    expect(outstandingByCustomer([sale({ installments: [inst({ status: 'cleared' })] })], TODAY)).toEqual([])
    expect(outstandingByCustomer([sale({ installments: [inst({ status: 'cancelled' })] })], TODAY)).toEqual([])
  })
})

describe('collectorWorkload', () => {
  it('groups by resolved collector with an unassigned group, biggest amount first', () => {
    const sales = [
      sale({ id: 's1', collectorId: 'p1', installments: [
        inst({ id: 'a', amount: 400, dueDate: '2026-08-01' }),
        inst({ id: 'b', amount: 600, dueDate: '2026-07-01', collectorId: 'p2' }), // override + overdue
      ] }),
      sale({ id: 's2', installments: [inst({ id: 'c', amount: 100 })] }), // no collector anywhere
    ]
    const loads = collectorWorkload(sales, TODAY)
    expect(loads.map((l) => l.collectorId)).toEqual(['p2', 'p1', null])
    expect(loads[0]).toMatchObject({ openCount: 1, amount: 600, overdueAmount: 600 })
    expect(loads[1]).toMatchObject({ openCount: 1, amount: 400, overdueAmount: 0 })
    expect(loads[2]).toMatchObject({ openCount: 1, amount: 100 })
  })
})

// ---- Partial returns and the figures built on them --------------------------
// Regression: agentStats and customerStats used to filter on saleCounts(), which
// is false for a RETURNED order, so a partially-returned sale was dropped
// entirely and the agent lost credit for volume the customer kept. The filter
// now asks contributesVolume(). See the note on that export.

describe('partial returns', () => {
  const agent: Agent = {
    id: 'ag-pr', createdAt: '', updatedAt: '', name: 'Partial Returns Agent',
    contactNumber: '', monthlyQuotaLiters: 10_000,
  }
  const customer: Customer = {
    id: 'cu-pr', createdAt: '', updatedAt: '', company: 'Returner Inc', brand: '',
    address: '', contactPerson: '', contactNumber: '', paymentTermDays: 30,
  }
  const base = {
    createdAt: '', updatedAt: '', agentId: agent.id, customerId: customer.id,
    date: '2026-08-10T00:00:00.000Z', pricePerLiter: 60, warehouseId: 'w1',
    fulfillment: 'delivery' as const, paymentMode: 'cash' as const, installments: [],
  }
  const range = { from: '2026-08-01T00:00:00.000Z', to: '2026-08-31T00:00:00.000Z' }

  const partial: Sale = {
    ...base, id: 'pr-1', volumeLiters: 5_000, status: 'returned',
    resolution: { date: '2026-08-12T00:00:00.000Z', reason: 'Short-filled', treatment: 'restocked', volumeReturned: 1_000 },
  }
  const whollyReturned: Sale = {
    ...base, id: 'pr-2', volumeLiters: 5_000, status: 'returned',
    resolution: { date: '2026-08-12T00:00:00.000Z', reason: 'Rejected', treatment: 'restocked' },
  }
  const writtenOff: Sale = {
    ...base, id: 'pr-3', volumeLiters: 5_000, status: 'returned',
    resolution: { date: '2026-08-12T00:00:00.000Z', reason: 'Contaminated', treatment: 'written_off' },
  }

  it('credits an agent for the volume the customer kept', () => {
    const [stat] = agentStats([agent], [partial], range)
    expect(stat.volume).toBe(4_000)
    expect(stat.revenue).toBe(240_000)
  })

  it('credits nothing for an order returned in full', () => {
    const [stat] = agentStats([agent], [whollyReturned], range)
    expect(stat.volume).toBe(0)
  })

  it('credits nothing for a return whose fuel never came back - the sale is still reversed', () => {
    // Net sales are sales less returns, whatever happened to the fuel. The
    // litres that never came back are a stock loss, and stockSaleVolume still
    // has them out of the tank; the agent's quota does not keep them.
    const [stat] = agentStats([agent], [writtenOff], range)
    expect(stat.volume).toBe(0)
    expect(stockSaleVolume(writtenOff)).toBe(5_000)
  })

  it('nets returns out of a customer\'s order volume', () => {
    const [stat] = customerStats([customer], [partial], range, null)
    expect(stat.avgOrderLiters).toBe(4_000)
  })

  it('drops a wholly-returned order from the customer\'s order history', () => {
    const [stat] = customerStats([customer], [whollyReturned], range, null)
    expect(stat.orderCount).toBe(0)
  })
})
