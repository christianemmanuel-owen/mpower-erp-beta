import { describe, expect, it } from 'vitest'
import { byDay, plannerEvents } from './planner'
import type { Delivery, LeaveRecord, Purchase, Sale, VehicleMaintenance } from '../data/types'

/**
 * One grid for everything dated. The cases pin what lands on which day, that
 * a multi-day item covers every day, that nothing concluded is drawn, and that
 * each event points at the screen that can act on it.
 */
const TODAY = '2026-09-23'
const base = { createdAt: '', updatedAt: '' }

const sale = (over: Partial<Sale> = {}): Sale => ({
  ...base, id: 's1', customerId: 'c1', agentId: 'a1', warehouseId: 'w1', productId: 'p1',
  date: '2026-09-01', volumeLiters: 8000, pricePerLiter: 60, totalAmount: 480000,
  paymentMode: 'check', paymentTerms: 'net45', deliveryMode: 'delivery', status: 'confirmed',
  installments: [{ id: 'i1', principal: 480000, interestPct: 0, amount: 480000, dueDate: '2026-09-30T00:00:00.000Z', status: 'pending' }],
  ...over,
} as Sale)

const src = {
  customers: [{ id: 'c1', company: 'Metro Mix' }] as never,
  suppliers: [{ id: 'v1', name: 'Seaoil' }] as never,
  trucks: [{ id: 't1', plateNumber: 'KLM 5678' }] as never,
  personnel: [{ id: 'n1', name: 'Nilo Cruz' }] as never,
}

describe('plannerEvents', () => {
  it('puts an open collection on its due date, pointing at the settle dialog', () => {
    const [e] = plannerEvents({ ...src, sales: [sale()] }, ['in'], TODAY)
    expect(e.date).toBe('2026-09-30')
    expect(e.title).toBe('Metro Mix')
    expect(e.amount).toBe(480000)
    expect(e.overdue).toBe(false)
    expect(e.href).toBe('/collection?record=s1%3A%3Ai1')
  })

  it('puts a check in hand on the day it can be banked, and only checks', () => {
    const inHand = sale({ installments: [{ id: 'i1', principal: 1, interestPct: 0, amount: 1, dueDate: '2026-09-01T00:00:00.000Z', status: 'collected', collectedAt: '2026-09-20T00:00:00.000Z', checkDate: '2026-10-05T00:00:00.000Z', referenceNo: 'BPI-1' }] })
    const cash = sale({ id: 's2', paymentMode: 'cash', installments: [{ id: 'i2', principal: 1, interestPct: 0, amount: 1, dueDate: '2026-09-01T00:00:00.000Z', status: 'collected', collectedAt: '2026-09-20T00:00:00.000Z' }] })
    const events = plannerEvents({ ...src, sales: [inHand, cash] }, ['bank'], TODAY)
    expect(events).toHaveLength(1)
    expect(events[0].date).toBe('2026-10-05')
    expect(events[0].sub).toBe('Check BPI-1')
    expect(events[0].href).toBe('/treasury')
  })

  it('draws only live trips, on their scheduled day, with truck and driver', () => {
    const trip = (id: string, status: Delivery['status'], date: string): Delivery => ({
      ...base, id, saleId: 's1', scheduleDate: date, deliveryAddress: 'Pasig', contactPerson: '', contactNumber: '',
      status, truckId: 't1', driverId: 'n1',
    })
    const events = plannerEvents({
      ...src, sales: [sale()],
      deliveries: [trip('d1', 'in_transit', '2026-09-22T00:00:00.000Z'), trip('d2', 'delivered', '2026-09-22T00:00:00.000Z'), trip('d3', 'scheduled', '2026-09-25T00:00:00.000Z')],
    }, ['trips'], TODAY)
    expect(events.map((e) => e.id)).toEqual(['trip:d1', 'trip:d3'])
    expect(events[0].sub).toBe('KLM 5678 · Nilo · In transit')
    expect(events[0].overdue).toBe(true)
    expect(events[0].href).toBe('/logistics?record=d1')
  })

  it('spreads maintenance and leave over every day they cover, skipping done ones', () => {
    const m = (id: string, status: VehicleMaintenance['status'], end?: string): VehicleMaintenance => ({
      ...base, id, truckId: 't1', kind: 'preventive', status, scheduledDate: '2026-09-28', endDate: end,
    })
    const leave: LeaveRecord = { ...base, id: 'l1', employeeId: 'n1', typeId: 'sil', dateFrom: '2026-09-24', dateTo: '2026-09-26' }
    const events = plannerEvents({ ...src, vehicleMaintenance: [m('m1', 'scheduled', '2026-09-29'), m('m2', 'done')], leaves: [leave] }, ['fleet', 'people'], TODAY)
    expect(events.filter((e) => e.layer === 'fleet').map((e) => e.date)).toEqual(['2026-09-28', '2026-09-29'])
    expect(events.filter((e) => e.layer === 'people').map((e) => e.date)).toEqual(['2026-09-24', '2026-09-25', '2026-09-26'])
    expect(events.find((e) => e.layer === 'people')?.title).toBe('Nilo Cruz')
  })

  it('puts an unpaid supplier installment on its due date, pointing at Payables', () => {
    const purchase = {
      ...base, id: 'p1', supplierId: 'v1', poReferenceNo: 'PO-1', status: 'received',
      installments: [{ id: 'k1', amount: 100, dueDate: '2026-09-10T00:00:00.000Z', status: 'pending' }, { id: 'k2', amount: 100, dueDate: '2026-09-11T00:00:00.000Z', status: 'paid' }],
    } as unknown as Purchase
    const events = plannerEvents({ ...src, purchases: [purchase] }, ['out'], TODAY)
    expect(events).toHaveLength(1)
    expect(events[0].overdue).toBe(true)
    expect(events[0].sub).toBe('PO PO-1')
    expect(events[0].href).toBe('/treasury/payables')
  })

  it('builds only the layers asked for, and groups by day', () => {
    const events = plannerEvents({ ...src, sales: [sale()], deliveries: [] }, ['trips'], TODAY)
    expect(events).toHaveLength(0)
    const map = byDay(plannerEvents({ ...src, sales: [sale(), sale({ id: 's9' })] }, ['in'], TODAY))
    expect(map.get('2026-09-30')).toHaveLength(2)
  })
})
