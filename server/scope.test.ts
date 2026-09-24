import { describe, expect, it } from 'vitest'
import {
  crewFieldViolations, isScoped, mayWriteRecord, ownsRecord, visibleRows,
} from './scope'

const office = { id: 'seat-office', scope: 'all' as const }
const admin = { id: 'seat-admin', isAdmin: true, scope: 'own' as const, personnelId: 'p1' }
const agent = { id: 'seat-agent', scope: 'own' as const, personnelId: 'p-agent', agentId: 'ag1' }
const crew = { id: 'seat-crew', scope: 'own' as const, personnelId: 'p-pahinante' }

const sale = (over: Record<string, unknown> = {}) => ({
  id: 's1', agentId: 'ag2', collectorId: 'p-someone', installments: [], ...over,
})
const trip = (over: Record<string, unknown> = {}) => ({
  id: 'd1', driverId: 'p-driver', pahinanteId: 'p-other', truckId: 't1', scheduleDate: '2026-09-12', ...over,
})

describe('who is scoped', () => {
  it('is only a field seat', () => {
    expect(isScoped(agent)).toBe(true)
    expect(isScoped(office)).toBe(false)
    // An admin is never scoped, whatever the field says - otherwise a mistake in
    // the seat form could lock the business out of its own records.
    expect(isScoped(admin)).toBe(false)
    expect(isScoped(null)).toBe(false)
  })
})

describe('own work', () => {
  it('gives an agent the sales they sold', () => {
    expect(ownsRecord(agent, 'sales', sale({ agentId: 'ag1' }))).toBe(true)
    expect(ownsRecord(agent, 'sales', sale())).toBe(false)
  })

  /** A collector's scope is the sale carrying the installment they were handed -
   *  there is no separate collection record to scope. */
  it('gives a collector the sales they collect, including one installment of one', () => {
    const collector = { id: 's', scope: 'own' as const, personnelId: 'p-collector' }
    expect(ownsRecord(collector, 'sales', sale({ collectorId: 'p-collector' }))).toBe(true)
    expect(ownsRecord(collector, 'sales', sale({
      installments: [{ id: 'i1', collectorId: 'p-collector' }],
    }))).toBe(true)
    expect(ownsRecord(collector, 'sales', sale())).toBe(false)
  })

  /** Every crew slot counts. A pahinante is as much on a trip as its driver. */
  it('gives crew the trips they are on, in any seat of the truck', () => {
    expect(ownsRecord(crew, 'deliveries', trip({ pahinanteId: 'p-pahinante' }))).toBe(true)
    expect(ownsRecord(crew, 'deliveries', trip({ guardId: 'p-pahinante' }))).toBe(true)
    expect(ownsRecord(crew, 'deliveries', trip())).toBe(false)
  })

  it('matches nothing when a scoped seat names no person', () => {
    const orphan = { id: 's', scope: 'own' as const }
    expect(ownsRecord(orphan, 'deliveries', trip({ pahinanteId: 'p-pahinante' }))).toBe(false)
  })
})

describe('what a list shows', () => {
  it('filters a field seat and leaves the office alone', () => {
    const rows = [sale({ id: 'a', agentId: 'ag1' }), sale({ id: 'b' }), sale({ id: 'c', agentId: 'ag1' })]
    expect(visibleRows(agent, 'sales', rows).map((r) => r.id)).toEqual(['a', 'c'])
    expect(visibleRows(office, 'sales', rows)).toHaveLength(3)
    // Reference data stays whole: an agent cannot sell to a customer they
    // cannot see.
    expect(visibleRows(agent, 'customers', rows)).toHaveLength(3)
  })
})

describe('what a field seat may write', () => {
  it('refuses somebody else’s record', () => {
    expect(mayWriteRecord(agent, 'sales', sale(), sale())).toBe(false)
    expect(mayWriteRecord(agent, 'sales', sale({ agentId: 'ag1' }), sale({ agentId: 'ag1' }))).toBe(true)
  })

  /** Both sides are checked, so a scoped seat can neither give its record away
   *  nor take over someone else's by writing itself into it. */
  it('refuses a handover in either direction', () => {
    expect(mayWriteRecord(agent, 'sales', sale({ agentId: 'ag1' }), sale({ agentId: 'ag2' }))).toBe(false)
    expect(mayWriteRecord(crew, 'deliveries', trip(), trip({ pahinanteId: 'p-pahinante' }))).toBe(false)
  })

  it('does not get in the office’s way', () => {
    expect(mayWriteRecord(office, 'sales', sale(), sale())).toBe(true)
    expect(mayWriteRecord(admin, 'deliveries', trip(), trip())).toBe(true)
  })
})

describe('what crew may change on a trip', () => {
  const before = trip({ pahinanteId: 'p-pahinante', checklist: { loadConfirmed: false } })

  it('allows the record of what happened', () => {
    expect(crewFieldViolations(before, { ...before, status: 'in_transit' })).toEqual([])
    expect(crewFieldViolations(before, { ...before, checklist: { loadConfirmed: true } })).toEqual([])
    expect(crewFieldViolations(before, { ...before, receivedBy: 'R. Cruz' })).toEqual([])
  })

  /** A phone that can reschedule a delivery or swap the truck is not recording
   *  a trip, it is re-planning one - and that is dispatch's decision. */
  it('refuses the plan', () => {
    expect(crewFieldViolations(before, { ...before, scheduleDate: '2026-09-20' })).toEqual(['scheduleDate'])
    expect(crewFieldViolations(before, { ...before, truckId: 't9' })).toEqual(['truckId'])
    // Including crewing themselves off the job.
    expect(crewFieldViolations(before, { ...before, pahinanteId: 'p-else' })).toEqual(['pahinanteId'])
  })
})
