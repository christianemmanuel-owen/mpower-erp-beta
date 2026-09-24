import { describe, expect, it } from 'vitest'
import {
  tripDeparture,
  availableCrew, availableTrucks, checklistProgress, deliveryPerformance, documentsFor,
  emptyChecklist, movementType, needsChecklist, scheduleDrift, wasOnTime, CHECKLIST_ITEMS,
} from './logistics'
import type { Delivery, Personnel, Truck } from '../data/types'

const NOW = Date.parse('2026-08-21T12:00:00.000Z')
/**
 * An instant on a given LOCAL day and hour. `wasOnTime` and `scheduleDrift` judge
 * by the operator's calendar day (a trip booked for the 5th and completed at 6pm
 * on the 5th is on time), so a fixture that means "6pm on the scheduled day" has
 * to be built in local time. Built as a UTC instant instead, `at(0, 18)` is 02:00
 * the NEXT day in Manila, and the test asserted the opposite of what it read as.
 */
const at = (offsetDays: number, hour = 9) => {
  const d = new Date(2026, 7, 21, 0, 0, 0, 0)
  d.setDate(d.getDate() + offsetDays)
  d.setHours(hour)
  return d.toISOString()
}

const trip = (over: Partial<Delivery> = {}): Delivery => ({
  id: 'd1', createdAt: '', updatedAt: '', saleId: 's1',
  scheduleDate: at(0), deliveryAddress: 'Somewhere', contactPerson: '', contactNumber: '',
  status: 'scheduled', ...over,
})

describe('movement types', () => {
  it('defaults to delivery to client for records written before movements existed', () => {
    expect(movementType(trip())).toBe('delivery_to_client')
  })

  it('gives each movement its own document set', () => {
    expect(documentsFor(trip({ movementType: 'delivery_to_client' }))).toContain('deliveryReceipt')
    expect(documentsFor(trip({ movementType: 'pickup_from_client' }))).toContain('clientLoadingSlip')
    expect(documentsFor(trip({ movementType: 'pickup_from_depot' }))).toContain('depotLoadingSlip')
    expect(documentsFor(trip({ movementType: 'delivery_from_depot' }))).toContain('internalReceipt')
  })

  it('skips the pre-dispatch checklist only for a pickup from a client', () => {
    // MPower is not dispatching a loaded vehicle in that one case.
    expect(needsChecklist(trip({ movementType: 'pickup_from_client' }))).toBe(false)
    expect(needsChecklist(trip({ movementType: 'delivery_to_client' }))).toBe(true)
    expect(needsChecklist(trip({ movementType: 'pickup_from_depot' }))).toBe(true)
  })
})

describe('checklistProgress', () => {
  it('reports everything outstanding when no checklist has been started', () => {
    const p = checklistProgress(undefined)
    expect(p.answered).toBe(0)
    expect(p.complete).toBe(false)
    expect(p.outstanding).toHaveLength(p.total)
  })

  it('names what is still unticked rather than just counting', () => {
    const p = checklistProgress({ ...emptyChecklist(), loadConfirmed: true, gpsPresent: true })
    expect(p.answered).toBe(2)
    expect(p.outstanding).toContain('Body cam present')
    expect(p.outstanding).not.toContain('Load confirmed')
  })

  it('is complete only when every item is ticked, and signed only with all three signatures', () => {
    const all = Object.fromEntries(
      CHECKLIST_ITEMS.map((i) => [i.key, true]),
    ) as unknown as ReturnType<typeof emptyChecklist>
    expect(checklistProgress(all).complete).toBe(true)
    expect(checklistProgress(all).signed).toBe(false)
    const sig = { name: 'x', image: 'data:image/png;base64,', at: '2026-09-17T00:00:00.000Z' }
    expect(checklistProgress({ ...all, signatures: { driver: sig, pahinante: sig, dispatcher: sig } }).signed).toBe(true)
  })
})

describe('wasOnTime', () => {
  it('is on time when completed on the scheduled day, whatever the hour', () => {
    expect(wasOnTime(trip({ status: 'delivered', scheduleDate: at(0, 8), outcome: { completedAt: at(0, 18) } }))).toBe(true)
  })

  it('is on time when completed early', () => {
    expect(wasOnTime(trip({ status: 'delivered', scheduleDate: at(2), outcome: { completedAt: at(0) } }))).toBe(true)
  })

  it('is late when completed the day after', () => {
    expect(wasOnTime(trip({ status: 'delivered', scheduleDate: at(0), outcome: { completedAt: at(1) } }))).toBe(false)
  })

  it('cannot be judged without a completion timestamp', () => {
    // Counting this as on time would flatter the figure; counting it as late
    // would punish record-keeping rather than performance.
    expect(wasOnTime(trip({ status: 'delivered', scheduleDate: at(0) }))).toBeNull()
  })

  it('cannot be judged while the trip is still running', () => {
    expect(wasOnTime(trip({ status: 'in_transit' }))).toBeNull()
  })

  it('cannot be judged for a failed trip - it was never completed at all', () => {
    expect(wasOnTime(trip({ status: 'failed', outcome: { completedAt: at(0) } }))).toBeNull()
  })
})

describe('scheduleDrift', () => {
  it('is null when the customer made no specific request', () => {
    expect(scheduleDrift(trip())).toBeNull()
  })

  it('is positive when Logistics pushed the trip later than asked', () => {
    expect(scheduleDrift(trip({ requestedDate: at(0), scheduleDate: at(3) }))).toBe(3)
  })

  it('is zero when the request was honoured', () => {
    expect(scheduleDrift(trip({ requestedDate: at(1, 8), scheduleDate: at(1, 16) }))).toBe(0)
  })
})

describe('deliveryPerformance', () => {
  it('reports nothing to measure for an empty fleet', () => {
    const p = deliveryPerformance([], NOW)
    expect(p.completionRate).toBeNull()
    expect(p.onTimeRate).toBeNull()
  })

  it('keeps completion and timeliness on separate denominators', () => {
    // A trip that never happened is not "late" - it is not completed. Folding
    // the two together hides a fleet that fails behind a fleet that runs late.
    const p = deliveryPerformance([
      trip({ id: 'a', status: 'delivered', scheduleDate: at(-3), outcome: { completedAt: at(-3) } }),
      trip({ id: 'b', status: 'delivered', scheduleDate: at(-2), outcome: { completedAt: at(-1) } }),
      trip({ id: 'c', status: 'failed', scheduleDate: at(-2) }),
    ], NOW)
    expect(p.concluded).toBe(3)
    expect(p.delivered).toBe(2)
    expect(p.failed).toBe(1)
    expect(p.completionRate).toBeCloseTo(2 / 3, 5)
    expect(p.onTimeRate).toBe(0.5)   // of the two delivered, one was late
  })

  it('excludes untimed completions from the on-time ratio but still counts them delivered', () => {
    const p = deliveryPerformance([
      trip({ id: 'a', status: 'delivered', scheduleDate: at(-3), outcome: { completedAt: at(-3) } }),
      trip({ id: 'b', status: 'delivered', scheduleDate: at(-2) }), // no timestamp
    ], NOW)
    expect(p.delivered).toBe(2)
    expect(p.judged).toBe(1)
    expect(p.onTimeRate).toBe(1)
  })

  it('ignores trips that are still running', () => {
    const p = deliveryPerformance([
      trip({ id: 'a', status: 'in_transit', scheduleDate: at(0) }),
      trip({ id: 'b', status: 'delivered', scheduleDate: at(-1), outcome: { completedAt: at(-1) } }),
    ], NOW)
    expect(p.concluded).toBe(1)
    expect(p.completionRate).toBe(1)
  })

  it('counts open trips whose scheduled day has passed', () => {
    const p = deliveryPerformance([
      trip({ id: 'a', status: 'scheduled', scheduleDate: at(-2) }),
      trip({ id: 'b', status: 'loading', scheduleDate: at(-1) }),
      trip({ id: 'c', status: 'scheduled', scheduleDate: at(+2) }),
    ], NOW)
    expect(p.overdueOpen).toBe(2)
  })

  it('does not count a trip scheduled for today as overdue', () => {
    expect(deliveryPerformance([trip({ status: 'scheduled', scheduleDate: at(0, 6) })], NOW).overdueOpen).toBe(0)
  })
})

describe('availability', () => {
  const trucks: Truck[] = [
    { id: 't1', createdAt: '', updatedAt: '', plateNumber: 'AAA-111', capacityLiters: 10_000 },
    { id: 't2', createdAt: '', updatedAt: '', plateNumber: 'BBB-222', capacityLiters: 10_000 },
  ]
  const crew: Personnel[] = [
    { id: 'p1', createdAt: '', updatedAt: '', name: 'Driver One', role: 'driver', contactNumber: '' },
    { id: 'p2', createdAt: '', updatedAt: '', name: 'Driver Two', role: 'driver', contactNumber: '' },
    { id: 'p3', createdAt: '', updatedAt: '', name: 'Retired', role: 'driver', contactNumber: '', active: false },
    { id: 'p4', createdAt: '', updatedAt: '', name: 'Pahinante', role: 'pahinante', contactNumber: '' },
  ]
  const day = at(0).slice(0, 10)

  it('frees everything when nothing is scheduled', () => {
    expect(availableTrucks(trucks, [], day).free).toHaveLength(2)
  })

  it('marks an assigned truck busy and says which trip has it', () => {
    const a = availableTrucks(trucks, [trip({ id: 'x', truckId: 't1', scheduleDate: at(0) })], day)
    expect(a.free.map((t) => t.id)).toEqual(['t2'])
    expect(a.busy[0].deliveryId).toBe('x')
  })

  it('releases a truck once its trip has concluded', () => {
    const done = trip({ id: 'x', truckId: 't1', scheduleDate: at(0), status: 'delivered' })
    expect(availableTrucks(trucks, [done], day).free).toHaveLength(2)
  })

  it('does not tie up a truck booked for a different day', () => {
    expect(availableTrucks(trucks, [trip({ truckId: 't1', scheduleDate: at(1) })], day).free).toHaveLength(2)
  })

  it('filters crew to the role asked for', () => {
    expect(availableCrew(crew, [], day, 'pahinante').free.map((p) => p.id)).toEqual(['p4'])
  })

  it('leaves inactive employees out of the pool entirely', () => {
    expect(availableCrew(crew, [], day, 'driver').free.map((p) => p.id)).toEqual(['p1', 'p2'])
  })

  it('counts a person busy whichever crew slot they were assigned to', () => {
    // The same person can be booked as a loader on one trip and a driver on
    // another; either way they cannot be in two places.
    const asLoader = trip({ id: 'x', loaderId: 'p1', scheduleDate: at(0) })
    expect(availableCrew(crew, [asLoader], day, 'driver').free.map((p) => p.id)).toEqual(['p2'])
  })
})

// ---- The requested/final distinction, end to end ---------------------------
// The two schedules only mean something if the request is actually captured
// when the trip is created. Regression: confirmSale used to write scheduleDate
// alone, so `requestedDate` was always blank and scheduleDrift always null -
// the distinction existed in the type and nowhere in the data.

describe('requested vs final schedule', () => {
  it('reports no drift when Logistics has not moved the trip', () => {
    const booked = trip({ requestedDate: at(2), scheduleDate: at(2) })
    expect(scheduleDrift(booked)).toBe(0)
  })

  it('shows the gap once the final schedule moves away from the request', () => {
    const moved = trip({ requestedDate: at(2), scheduleDate: at(5) })
    expect(scheduleDrift(moved)).toBe(3)
  })

  it('judges on time against the final schedule, not the original request', () => {
    // Logistics negotiated the 5th and delivered on the 5th. That is on time,
    // even though the customer first asked for the 2nd - otherwise every
    // renegotiated slot would score as a miss.
    const renegotiated = trip({
      status: 'delivered',
      requestedDate: at(2),
      scheduleDate: at(5),
      outcome: { completedAt: at(5, 14) },
    })
    expect(wasOnTime(renegotiated)).toBe(true)
    expect(scheduleDrift(renegotiated)).toBe(3)
  })
})

describe('tripDeparture', () => {
  it('checks a ban against the departure time, not the time the date field holds', () => {
    // The date input stores midnight; the day strip stores the departure.
    const d = { scheduleDate: '2026-09-29T00:00:00.000Z', scheduleTime: '10:30' }
    const at = tripDeparture(d)
    expect(at.getHours()).toBe(10)
    expect(at.getMinutes()).toBe(30)
    expect(at.getDate()).toBe(new Date(d.scheduleDate).getDate())
    // Without a departure the stored instant stands.
    expect(tripDeparture({ scheduleDate: '2026-09-29T07:00:00.000Z' }).toISOString()).toBe('2026-09-29T07:00:00.000Z')
  })
})
