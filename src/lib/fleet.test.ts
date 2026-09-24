import { describe, expect, it } from 'vitest'
import { banApplies, bansFor, clearDeparture, dayBans, maintenanceCovers, trucksInMaintenance } from './logistics'
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

describe('a ban against the whole run, not the departure', () => {
  const evening = rule({ id: 'r2', startTime: '17:00', endTime: '22:00' })
  // A local Monday morning. Built from parts so the test holds in any zone.
  const monday = (h: number, m = 0) => { const d = new Date(2026, 7, 24, h, m); return d.toISOString() }

  it('catches a truck that leaves before the window but is still out when it opens', () => {
    // Left at 05:30 on an eight-hour run: on the road all through 06:00-10:00.
    expect(banApplies(rule(), 'DAA-2841', { weekday: 1, time: '05:30', hours: 8 })).toBe(true)
    // Without hours only the moment is checked, as before.
    expect(banApplies(rule(), 'DAA-2841', { weekday: 1, time: '05:30' })).toBe(false)
    // A run that is back before the window opens is clear, and one that
    // leaves as it lifts is clear - the window is half-open.
    expect(banApplies(rule(), 'DAA-2841', { weekday: 1, time: '04:00', hours: 2 })).toBe(false)
    expect(banApplies(rule(), 'DAA-2841', { weekday: 1, time: '10:00', hours: 2 })).toBe(false)
  })

  it('counts the slice after midnight only on a day the rule is in force', () => {
    const early = rule({ startTime: '00:00', endTime: '03:00', weekdays: [1] })
    // Sunday 23:00, four hours: into Monday 00:00-03:00.
    expect(banApplies(early, 'DAA-2841', { weekday: 0, time: '23:00', hours: 4 })).toBe(true)
    // Monday 23:00 into Tuesday, when the rule is off.
    expect(banApplies(early, 'DAA-2841', { weekday: 1, time: '23:00', hours: 4 })).toBe(false)
  })

  it('suggests the first quarter hour from which the whole run is clear', () => {
    // Two windows, an eight-hour run: nothing fits between 10:00 and 17:00,
    // so the first clear departure is when the evening window lifts.
    expect(clearDeparture([rule(), evening], 'DAA-2841', monday(5, 30), 8)).toBe('22:00')
    // An all-day rule leaves no departure at all.
    expect(clearDeparture([rule({ startTime: '00:00', endTime: '23:59' })], 'DAA-2841', monday(5, 30), 1)).toBe(null)
    // A four-hour run fits at 10:00 exactly.
    expect(clearDeparture([rule(), evening], 'DAA-2841', monday(5, 30), 4)).toBe('10:00')
    // Only the morning rule: 10:00 clears an eight-hour run.
    expect(clearDeparture([rule()], 'DAA-2841', monday(5, 30), 8)).toBe('10:00')
  })

  it('lists the windows in force that day, in order, for the strip', () => {
    expect(dayBans([evening, rule()], 'DAA-2841', monday(5, 30)).map((r) => r.id)).toEqual(['r1', 'r2'])
    // Sunday: neither.
    expect(dayBans([evening, rule()], 'DAA-2841', new Date(2026, 7, 23, 5).toISOString())).toEqual([])
    // A light truck under a heavy-only rule: neither.
    expect(dayBans([rule({ appliesTo: 'heavy' })], 'DAA-2841', monday(5, 30), { heavy: false })).toEqual([])
  })
})
