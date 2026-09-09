import { describe, expect, it } from 'vitest'
import { banApplies, bansFor, maintenanceCovers, trucksInMaintenance } from './logistics'
import type { TruckBanRule, VehicleMaintenance } from '../data/types'

const rule = (over: Partial<TruckBanRule> = {}): TruckBanRule => ({
  id: 'r1', authority: 'MMDA', area: 'EDSA', weekdays: [1, 2, 3, 4, 5],
  startTime: '06:00', endTime: '10:00', plateEndsWith: [], active: true,
  createdAt: '', updatedAt: '', ...over,
} as TruckBanRule)

const job = (over: Partial<VehicleMaintenance> = {}): VehicleMaintenance => ({
  id: 'm1', truckId: 't1', kind: 'preventive', status: 'scheduled',
  scheduledDate: '2026-08-26T00:00:00.000Z', createdAt: '', updatedAt: '', ...over,
} as VehicleMaintenance)

describe('banApplies', () => {
  // Monday 2026-08-24 at 07:30, inside a 06:00-10:00 weekday window.
  const monday = { weekday: 1, time: '07:30' }

  it('catches every plate when no plate digits are listed', () => {
    // Empty means a blanket truck ban, not a ban on nothing. Reading it the
    // other way would silently exempt the entire fleet.
    expect(banApplies(rule(), 'DAA-2841', monday)).toBe(true)
    expect(banApplies(rule(), 'NCP-9033', monday)).toBe(true)
  })

  it('restricts to the listed last digit when number coding is in force', () => {
    const coding = rule({ plateEndsWith: ['1', '2'] })
    expect(banApplies(coding, 'DAA-2841', monday)).toBe(true)
    expect(banApplies(coding, 'NCP-9033', monday)).toBe(false)
  })

  it('ignores a rule on a day it does not cover', () => {
    expect(banApplies(rule(), 'DAA-2841', { weekday: 0, time: '07:30' })).toBe(false)
  })

  it('ignores a rule outside its window', () => {
    expect(banApplies(rule(), 'DAA-2841', { weekday: 1, time: '11:00' })).toBe(false)
  })

  it('handles a window that wraps past midnight', () => {
    // The naive from <= t <= to comparison matches nothing here, which would
    // tell a dispatcher a night ban does not apply.
    const night = rule({ startTime: '22:00', endTime: '05:00' })
    expect(banApplies(night, 'DAA-2841', { weekday: 1, time: '23:30' })).toBe(true)
    expect(banApplies(night, 'DAA-2841', { weekday: 1, time: '03:00' })).toBe(true)
    expect(banApplies(night, 'DAA-2841', { weekday: 1, time: '12:00' })).toBe(false)
  })

  it('ignores a rule that has been switched off', () => {
    expect(banApplies(rule({ active: false }), 'DAA-2841', monday)).toBe(false)
  })

  it('names every rule that catches a truck, not just the first', () => {
    const rules = [
      rule({ id: 'a', authority: 'MMDA', area: 'EDSA' }),
      rule({ id: 'b', authority: 'Manila', area: 'Espana' }),
      rule({ id: 'c', weekdays: [0] }),
    ]
    // Monday 24 Aug 2026, 07:30 local.
    const hits = bansFor(rules, 'DAA-2841', '2026-08-24T07:30:00')
    expect(hits.map((r) => r.id)).toEqual(['a', 'b'])
  })

  it('returns nothing for an unparseable schedule rather than throwing', () => {
    expect(bansFor([rule()], 'DAA-2841', 'not a date')).toEqual([])
  })
})

describe('maintenance', () => {
  it('covers a single day when there is no end date', () => {
    expect(maintenanceCovers(job(), '2026-08-26')).toBe(true)
    expect(maintenanceCovers(job(), '2026-08-27')).toBe(false)
  })

  it('covers both ends of a range inclusively', () => {
    const long = job({ scheduledDate: '2026-08-24T00:00:00.000Z', endDate: '2026-08-26T00:00:00.000Z' })
    expect(maintenanceCovers(long, '2026-08-24')).toBe(true)
    expect(maintenanceCovers(long, '2026-08-25')).toBe(true)
    expect(maintenanceCovers(long, '2026-08-26')).toBe(true)
    expect(maintenanceCovers(long, '2026-08-27')).toBe(false)
  })

  it('does not take a truck off the road for a finished or cancelled job', () => {
    expect(maintenanceCovers(job({ status: 'done' }), '2026-08-26')).toBe(false)
    expect(maintenanceCovers(job({ status: 'cancelled' }), '2026-08-26')).toBe(false)
    expect(maintenanceCovers(job({ status: 'in_progress' }), '2026-08-26')).toBe(true)
  })

  it('collects the trucks that are unavailable on a day', () => {
    const jobs = [
      job({ id: 'a', truckId: 't1' }),
      job({ id: 'b', truckId: 't2', status: 'done' }),
      job({ id: 'c', truckId: 't3', scheduledDate: '2026-09-02T00:00:00.000Z' }),
    ]
    expect([...trucksInMaintenance(jobs, '2026-08-26')]).toEqual(['t1'])
  })
})
