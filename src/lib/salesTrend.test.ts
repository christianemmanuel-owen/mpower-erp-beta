import { describe, expect, it } from 'vitest'
import { salesTrend, trendGrainFor } from './metrics'
import type { Sale } from '../data/types'

/** Day over a week, week over a month, month over a year, quarter beyond. */
const sale = (date: string, liters: number, over: Partial<Sale> = {}): Sale => ({
  id: date + liters, createdAt: '', updatedAt: '', agentId: 'a', customerId: 'c', warehouseId: 'w',
  date: `${date}T04:00:00.000Z`, pricePerLiter: 60, volumeLiters: liters, status: 'confirmed',
  fulfillment: 'delivery', paymentMode: 'cash', installments: [], ...over,
})

describe('sales trend', () => {
  it('picks the grain from the range', () => {
    expect(trendGrainFor({ from: '2026-09-11', to: '2026-09-17' })).toBe('day')
    expect(trendGrainFor({ from: '2026-08-19', to: '2026-09-17' })).toBe('week')
    expect(trendGrainFor({ from: '2026-06-20', to: '2026-09-17' })).toBe('month')
    expect(trendGrainFor({ from: '2024-01-01', to: '2026-09-17' })).toBe('quarter')
  })

  it('gives one bar per day across a week, empty days included', () => {
    const pts = salesTrend([sale('2026-09-12', 1000), sale('2026-09-12', 500), sale('2026-09-15', 200)], { from: '2026-09-11', to: '2026-09-17' }, 'day')
    expect(pts).toHaveLength(7)
    expect(pts.map((p) => p.liters)).toEqual([0, 1500, 0, 0, 200, 0, 0])
    expect(pts[1].revenue).toBe(90_000)
  })

  it('cuts a month into 7-day weeks from the start of the range', () => {
    const pts = salesTrend([sale('2026-08-19', 100), sale('2026-08-25', 100), sale('2026-09-17', 100)], { from: '2026-08-19', to: '2026-09-17' }, 'week')
    expect(pts.map((p) => [p.from, p.to])).toEqual([
      ['2026-08-19', '2026-08-25'], ['2026-08-26', '2026-09-01'], ['2026-09-02', '2026-09-08'], ['2026-09-09', '2026-09-15'], ['2026-09-16', '2026-09-17'],
    ])
    expect(pts.map((p) => p.liters)).toEqual([200, 0, 0, 0, 100])
  })

  it('uses calendar months and quarters, clipped to the range', () => {
    const months = salesTrend([sale('2026-07-31', 100), sale('2026-08-01', 100)], { from: '2026-06-20', to: '2026-09-17' }, 'month')
    expect(months.map((p) => p.label)).toEqual(['Jun 26', 'Jul 26', 'Aug 26', 'Sep 26'])
    expect(months[0].from).toBe('2026-06-20')
    expect(months.map((p) => p.liters)).toEqual([0, 100, 100, 0])
    const quarters = salesTrend([sale('2026-01-15', 100)], { from: '2025-10-01', to: '2026-09-17' }, 'quarter')
    expect(quarters.map((p) => p.label)).toEqual(['Q4 25', 'Q1 26', 'Q2 26', 'Q3 26'])
    expect(quarters[1].liters).toBe(100)
  })

  it('is on the sales basis - a return comes off, whatever happened to the fuel', () => {
    const returned = sale('2026-09-12', 1000, { status: 'returned', resolution: { date: '', reason: 'x', treatment: 'refunded', backToStock: false } })
    const pts = salesTrend([returned, sale('2026-09-12', 300)], { from: '2026-09-11', to: '2026-09-17' }, 'day')
    expect(pts[1].liters).toBe(300)
  })
})
