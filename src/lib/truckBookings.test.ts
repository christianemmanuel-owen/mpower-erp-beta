import { describe, expect, it } from 'vitest'
import { clashesWith, fmtHour, suggestedHours, tripStartHour, truckBookings } from './logistics'
import type { Delivery } from '../data/types'

const trip = (over: Partial<Delivery>): Delivery => ({
  id: 'x', createdAt: '', updatedAt: '', saleId: 's', scheduleDate: '2026-09-19T00:00:00.000Z',
  deliveryAddress: 'Pasig', contactPerson: '', contactNumber: '', status: 'scheduled', truckId: 't1', ...over,
})

describe('truck bookings', () => {
  it('reads the typed time ahead of the date stamp', () => {
    expect(tripStartHour(trip({ scheduleTime: '08:30' }))).toBe(8.5)
    expect(fmtHour(14.5)).toBe('14:30')
  })

  it('lists the other open trips on the truck that day, earliest first', () => {
    const list = truckBookings([
      trip({ id: 'a', scheduleTime: '14:00' }),
      trip({ id: 'b', scheduleTime: '08:00' }),
      trip({ id: 'c', scheduleTime: '10:00', status: 'delivered' }),
      trip({ id: 'd', scheduleTime: '09:00', truckId: 't2' }),
      trip({ id: 'me', scheduleTime: '11:00' }),
    ], 't1', '2026-09-19', 'me')
    expect(list.map((b) => fmtHour(b.start))).toEqual(['08:00', '14:00'])
  })

  it('flags a start inside another trip’s two-hour block', () => {
    const bookings = truckBookings([trip({ id: 'a', scheduleTime: '08:00' })], 't1', '2026-09-19')
    expect(clashesWith(9, bookings)).toHaveLength(1)
    expect(clashesWith(7, bookings)).toHaveLength(1)
    expect(clashesWith(10, bookings)).toHaveLength(0)
    expect(clashesWith(6, bookings)).toHaveLength(0)
  })
})

describe('time needed', () => {
  it('turns a one-way drive into a whole trip, rounded up to the half hour', () => {
    // 25 min each way + 30 unload + 15 slack = 95 min → 2h on the half-hour grid.
    expect(suggestedHours(25)).toBe(2)
    // 70 each way → 185 min → 3.5h
    expect(suggestedHours(70)).toBe(3.5)
    // Round the corner: never under an hour.
    expect(suggestedHours(5)).toBe(1)
  })

  it('lets a long trip block the truck for longer, and clash accordingly', () => {
    const bookings = truckBookings([trip({ id: 'a', scheduleTime: '08:00', durationHours: 4 })], 't1', '2026-09-19')
    expect(bookings[0].end).toBe(12)
    expect(clashesWith(11, bookings)).toHaveLength(1)
    expect(clashesWith(12, bookings)).toHaveLength(0)
    // And a long new trip reaches forward into a later booking.
    expect(clashesWith(6, bookings, 3)).toHaveLength(1)
    expect(clashesWith(6, bookings, 2)).toHaveLength(0)
  })
})
