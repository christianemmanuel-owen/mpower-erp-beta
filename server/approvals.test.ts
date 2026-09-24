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

/**
 * Undoing a decision. A mistaken approval has already posted a record, so the
 * route has to unwind that from the approval's own audit row - and refuse when
 * somebody has worked on the record since.
 */
const DECIDED = {
  ...PARKED,
  status: 'approved',
  decided_by: 'seat-admin', decided_by_name: 'Admin', decided_at: '2026-09-02T00:00:00.000Z',
}

function reverseDb(row: Record<string, unknown>, opts: { approvalRow?: Record<string, unknown> | null; later?: Record<string, unknown> | null; current?: Record<string, unknown> | null } = {}) {
  const sql: { text: string; binds: unknown[] }[] = []
  const db = {
    prepare(text: string) {
      const stmt = {
        binds: [] as unknown[],
        bind(...binds: unknown[]) { stmt.binds = binds; sql.push({ text, binds }); return stmt },
        first: async () => {
          if (text.startsWith('SELECT * FROM approvals')) return row
          if (text.includes("action = 'approve'")) return opts.approvalRow === undefined ? { id: 7, at: '2026-09-02T00:00:00.000Z', changes: JSON.stringify({ volumeLiters: [null, 20000], warehouseId: [null, 'wh-cavite'] }) } : opts.approvalRow
          if (text.includes("action != 'reverse'")) return opts.later ?? null
          if (text.startsWith('SELECT data FROM records')) return opts.current ? { data: JSON.stringify(opts.current) } : null
          return null
        },
        all: async () => ({ results: [] }),
        run: async () => ({ success: true }),
      }
      return stmt
    },
    // Notifications fan out through batch; the statements were already
    // captured by bind() above, so this only has to not throw.
    batch: async () => [],
  }
  return { db: db as unknown as D1Database, sql }
}

const reverse = (db: D1Database, me: Seat, body: unknown = {}) =>
  handleApprovals(db, ['approvals', 'ap1', 'reverse'], 'POST', new URL('http://x/api/approvals/ap1/reverse'),
    new Request('http://x/api/approvals/ap1/reverse', { method: 'POST', body: JSON.stringify(body) }), me)

describe('undoing a decision', () => {
  it('refuses a seat that cannot approve, and a request not yet decided', async () => {
    expect((await reverse(reverseDb(DECIDED).db, seat({ isAdmin: false, canApprove: false })))?.status).toBe(403)
    expect((await reverse(reverseDb(PARKED).db, seat()))?.status).toBe(409)
  })

  it('lets only an admin or the deciding approver undo it', async () => {
    const other = seat({ id: 'seat-other', isAdmin: false, canApprove: true })
    expect((await reverse(reverseDb(DECIDED).db, other))?.status).toBe(403)
    const decider = seat({ id: 'seat-admin', isAdmin: false, canApprove: true })
    expect((await reverse(reverseDb(DECIDED).db, decider))?.status).toBe(200)
  })

  it('puts a rejection straight back in the queue', async () => {
    const { db, sql } = reverseDb({ ...DECIDED, status: 'rejected' })
    const res = await reverse(db, seat(), { note: 'Rejected the wrong one' })
    expect(res?.status).toBe(200)
    const upd = sql.find((s) => s.text.startsWith('UPDATE approvals SET status'))
    expect(upd?.binds[0]).toBe('pending')
    expect(sql.some((s) => s.text.startsWith('DELETE FROM records'))).toBe(false)
    const log = sql.find((s) => s.text.includes('INSERT INTO audit_log'))
    expect(log?.binds).toContain('reverse')
    expect(log?.binds.some((b) => typeof b === 'string' && b.includes('Rejected the wrong one'))).toBe(true)
  })

  it('removes the record an approved create had posted', async () => {
    const { db, sql } = reverseDb(DECIDED)
    expect((await reverse(db, seat()))?.status).toBe(200)
    const del = sql.find((s) => s.text.startsWith('DELETE FROM records'))
    expect(del?.binds).toEqual(['sales', 'sale-1'])
    // And tells the submitter it is back in the queue.
    expect(sql.some((s) => s.text.includes('INSERT INTO notifications'))).toBe(true)
  })

  it('restores the old field values an approved edit had overwritten', async () => {
    const { db, sql } = reverseDb(
      { ...DECIDED, action: 'update' },
      {
        approvalRow: { id: 7, at: '2026-09-02T00:00:00.000Z', changes: JSON.stringify({ volumeLiters: [15000, 20000], notes: [null, 'rushed'] }) },
        current: { id: 'sale-1', volumeLiters: 20000, notes: 'rushed', pricePerLiter: 42 },
      },
    )
    expect((await reverse(db, seat()))?.status).toBe(200)
    const put = sql.find((s) => s.text.startsWith('INSERT INTO records'))
    const saved = JSON.parse(put?.binds[2] as string)
    expect(saved.volumeLiters).toBe(15000)
    expect(saved.pricePerLiter).toBe(42)
    expect('notes' in saved).toBe(false)
  })

  it('refuses to unwind over work done on the record since', async () => {
    const { db, sql } = reverseDb(DECIDED, { later: { seat_name: 'Rey Mendoza', action: 'update', at: '2026-09-03T00:00:00.000Z' } })
    const res = await reverse(db, seat())
    expect(res?.status).toBe(409)
    expect(await res?.text()).toContain('Rey Mendoza')
    expect(sql.some((s) => s.text.startsWith('UPDATE approvals'))).toBe(false)
  })
})
