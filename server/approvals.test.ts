import { describe, expect, it } from 'vitest'
import { handleApprovals } from './approvals'
import type { Seat } from './core'

/**
 * The amend route, which is the one place in the System where somebody changes
 * a write that somebody else authored. Its guards are the whole feature: who
 * may do it, when it is still allowed, and whether the change is recorded as
 * its own act rather than folded silently into the approval.
 *
 * The D1 here is a stub, not a database. These cases are about the route's
 * decisions - the SQL it emits is asserted only where the decision is visible
 * in it (that the payload is merged, that an audit row is written).
 */

const PARKED = {
  id: 'ap1',
  tbl: 'sales',
  record_id: 'sale-1',
  action: 'create',
  status: 'pending',
  payload: JSON.stringify({ id: 'sale-1', volumeLiters: 20000, pricePerLiter: 42, warehouseId: 'wh-cavite' }),
  summary: 'New sale - 20,000 L @ ₱42/L',
  requested_by: 'seat-staff',
  requested_by_name: 'Rey Mendoza',
  requested_at: '2026-09-01T00:00:00.000Z',
  decided_by: null, decided_by_name: null, decided_at: null, decision_note: null,
}

/** Records every statement so a case can assert what the route decided to write. */
function fakeDb(row: Record<string, unknown> | null = PARKED) {
  const sql: { text: string; binds: unknown[] }[] = []
  const db = {
    prepare(text: string) {
      const stmt = {
        binds: [] as unknown[],
        bind(...binds: unknown[]) { stmt.binds = binds; sql.push({ text, binds }); return stmt },
        first: async () => (text.startsWith('SELECT * FROM approvals') ? row : null),
        all: async () => ({ results: [] }),
        run: async () => ({ success: true }),
      }
      return stmt
    },
  }
  return { db: db as unknown as D1Database, sql }
}

const seat = (over: Partial<Seat> = {}): Seat => ({
  id: 'seat-admin', name: 'Admin', username: 'admin',
  passwordHash: '', salt: '', isAdmin: true, ...over,
})

const patch = (body: unknown) =>
  new Request('http://x/api/approvals/ap1', { method: 'PATCH', body: JSON.stringify(body) })

const call = (db: D1Database, me: Seat, body: unknown) =>
  handleApprovals(db, ['approvals', 'ap1'], 'PATCH', new URL('http://x/api/approvals/ap1'), patch(body), me)

describe('amending a parked input', () => {
  it('refuses a seat that cannot approve', async () => {
    const { db } = fakeDb()
    const res = await call(db, seat({ isAdmin: false, canApprove: false }), { payload: { volumeLiters: 1 } })
    expect(res?.status).toBe(403)
  })

  it('lets a non-admin approver amend', async () => {
    const { db } = fakeDb()
    const res = await call(db, seat({ isAdmin: false, canApprove: true }), { payload: { volumeLiters: 18000 } })
    expect(res?.status).toBe(200)
  })

  it('refuses once the request has already been decided', async () => {
    // Otherwise an approved sale could be quietly rewritten through this route
    // long after it posted, with nothing on the record saying so.
    const { db } = fakeDb({ ...PARKED, status: 'approved' })
    const res = await call(db, seat(), { payload: { volumeLiters: 1 } })
    expect(res?.status).toBe(409)
  })

  it('refuses a body with no payload rather than writing an empty one', async () => {
    const { db } = fakeDb()
    const res = await call(db, seat(), { note: 'oops' })
    expect(res?.status).toBe(400)
  })

  it('merges over the parked payload instead of replacing it', async () => {
    // The drawer sends only what it edited. A replace would drop every field
    // the approver never touched, including the record's own id.
    const { db, sql } = fakeDb()
    await call(db, seat(), { payload: { warehouseId: 'wh-batangas' } })
    const update = sql.find((s) => s.text.startsWith('UPDATE approvals SET payload'))
    const saved = JSON.parse(update?.binds[0] as string)
    expect(saved).toMatchObject({
      id: 'sale-1', volumeLiters: 20000, pricePerLiter: 42, warehouseId: 'wh-batangas',
    })
  })

  it('records the change as its own act, naming the fields', async () => {
    const { db, sql } = fakeDb()
    await call(db, seat(), { payload: { volumeLiters: 18000 } })
    const entry = sql.find((s) => s.text.includes('INSERT INTO audit_log'))
    expect(entry).toBeTruthy()
    expect(entry?.binds).toContain('amend')
    expect(entry?.binds.some((b) => typeof b === 'string' && b.includes('volumeLiters'))).toBe(true)
  })

  it('rewrites the summary so the queue stops describing the old figures', async () => {
    const { db, sql } = fakeDb()
    await call(db, seat(), { payload: { volumeLiters: 18000 } })
    const update = sql.find((s) => s.text.startsWith('UPDATE approvals SET payload'))
    expect(update?.binds[1]).toContain('18,000 L')
  })

  it('writes nothing when the payload came back identical', async () => {
    const { db, sql } = fakeDb()
    const res = await call(db, seat(), { payload: { volumeLiters: 20000 } })
    expect(res?.status).toBe(200)
    expect(sql.some((s) => s.text.startsWith('UPDATE approvals SET payload'))).toBe(false)
    expect(sql.some((s) => s.text.includes('INSERT INTO audit_log'))).toBe(false)
  })

  it('refuses a change that would not survive validation', async () => {
    const { db } = fakeDb()
    const res = await call(db, seat(), { payload: { status: 'not-a-real-status' } })
    expect(res?.status).toBe(422)
  })
})
