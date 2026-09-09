/// <reference types="@cloudflare/workers-types" />
// The entire API - one catch-all Cloudflare Pages Function routing /api/*.
//
//   POST   /api/login              { username, password } → { token, seat }
//   POST   /api/logout
//   GET    /api/me                 → seat for the bearer token
//   GET    /api/status             → { seats, records }  (unauthenticated, for login hint / publish flow)
//   POST   /api/import             { tables: { tbl: rows[] }, mode?: 'replace' }  (admin)
//   GET    /api/:tbl               → all rows
//   GET    /api/:tbl/:id           → one row
//   POST   /api/:tbl               body = record fields → created record (server assigns id + timestamps)
//   PUT    /api/:tbl/:id           body = changes → updated record
//   DELETE /api/:tbl/:id
//
// Infrastructure endpoints (see app/server/*):
//   /api/attachments/*             uploaded digital copies          (1.2–1.5, 1.9)
//   /api/audit                     staff input history              (2.2)
//   /api/approvals/*               approval-based inputs            (2.1)
//   /api/notifications/*           notification inbox + push        (2.11)
//   /api/refs/*                    document reference numbering     (1.2, 1.3, 1.5, 1.6)
//
// Low supply warnings (2.3) have no endpoint of their own: they are evaluated on
// the writes that move stock, at the bottom of the POST/PUT/DELETE branches.
//
// Records are JSON documents in the `records` table; the client owns the shapes.
// Seats are guarded: writes require admin, password fields never leave the server.

import {
  err, getRow, json, newId, now, putStmt, randomHex, sha256hex, tableRows,
  type Env, type Rec, type Seat,
} from '../../server/core'
import * as attachments from '../../server/attachments'
import * as approvals from '../../server/approvals'
import * as audit from '../../server/audit'
import * as notifications from '../../server/notifications'
import { handleRefs } from '../../server/refs'
import * as stock from '../../server/stock'
import { canWriteRecord } from '../../server/access'
import { validateRecord } from '../../server/validate'

const TABLES = new Set([
  'suppliers', 'warehouses', 'agents', 'customers', 'bankAccounts', 'personnel',
  'trucks', 'purchases', 'sales', 'deliveries', 'supplierQuotes', 'seats',
  'shifts', 'attendance', 'leaves', 'holidays', 'payrollRuns', 'hrSettings',
  // Added 2026-08-20 alongside the infrastructure layers, so the module work in
  // later waves has somewhere to write. Each is a plain JSON-document table like
  // the ones above; see src/data/types.ts for the shapes.
  'products', 'stockThresholds', 'todos', 'announcements', 'pricePostings',
  'drugTests', 'vehicleMaintenance', 'truckBanRules', 'dashboardConfigs',
  // Per-seat dashboard arrangement. Reorders only; see DashboardLayout.
  'dashboardLayouts',
  // System configuration that isn't a business record - approval rules today.
  // Admin-only for writes; see ADMIN_WRITE_TABLES below.
  'appSettings',
])

/** Tables only an administrator may write, on top of the HR rules below. */
const ADMIN_WRITE_TABLES = new Set(['appSettings'])

/**
 * Tables whose every row belongs to exactly one seat, and to nobody else.
 *
 * `todos` is the load-bearing one. Exhibit A calls the to-do list "per user",
 * and TodoCard's own comment promised "a manager cannot see what an encoder has
 * written to themselves" - but that was enforced only by a client-side
 * `.filter(t => t.seatId === seat.id)`. The API happily returned every seat's
 * private notes to anyone with an account, and devtools was enough to read them.
 *
 * Note that admins are NOT exempt here, unlike everywhere else in this file. An
 * admin is exactly the manager the promise is about; letting them through would
 * keep the hole open for the people it was meant to keep out.
 */
const OWN_SEAT_TABLES = new Set(['todos', 'dashboardLayouts'])

// ---- HR access rules --------------------------------------------------------
// Payroll data is sensitive: the nav-rail guard on the client is cosmetic, these
// are the checks that matter.
//   - HR tables need the 'hr' module (or admin) even to read.
//   - Setup tables (shifts, holidays, hrSettings) are readable by HR seats but
//     writable only by admins.
//   - `personnel` is shared with Trips, so everyone can read it - but pay-related
//     fields are stripped unless the seat has HR access, and writes need HR access.
//   - Finalized payroll runs are immutable except for admins (un-finalize/fix).

const HR_TABLES = new Set(['attendance', 'leaves', 'shifts', 'holidays', 'payrollRuns', 'hrSettings', 'drugTests'])
const HR_ADMIN_WRITE = new Set(['shifts', 'holidays', 'hrSettings'])
const PERSONNEL_HR_FIELDS = [
  'rateType', 'baseRate', 'allowancePerDay', 'paySchedule', 'hireDate',
  'agentId', 'commissionRate', 'govIds', 'statutory', 'leaveEntitlements',
]

/** Which module grants access to which table - used both by the record routes
 * and, via canReadTable/canWriteTable below, by the attachment routes, so a
 * document is exactly as guarded as the record it hangs off. */
const TABLE_MODULE: Record<string, string> = {
  purchases: 'inventory',
  supplierQuotes: 'inventory',
  stockThresholds: 'inventory',
  vehicleMaintenance: 'logistics',
  truckBanRules: 'logistics',
  sales: 'sales',
  deliveries: 'logistics',
  trucks: 'logistics',
  customers: 'accounts',
  suppliers: 'accounts',
}

const canHr = (seat: Seat) => seat.isAdmin || (seat.modules ?? []).includes('hr')

/** Pay-sensitive employee fields stay within HR - Trips only needs name/role/contact. */
function stripPersonnel(rec: Rec): Rec {
  const safe = { ...rec }
  for (const f of PERSONNEL_HR_FIELDS) delete safe[f]
  return safe
}

/** Password material stays server-side. */
function stripSeat<T extends Rec>(seat: T): Rec {
  const { passwordHash: _p, salt: _s, ...safe } = seat as Rec & { passwordHash?: string; salt?: string }
  return safe
}

const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30 // 30 days

async function authSeat(request: Request, db: D1Database): Promise<Seat | null> {
  const header = request.headers.get('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token) return null
  const session = await db
    .prepare('SELECT seat_id, created_at FROM sessions WHERE token = ?')
    .bind(token)
    .first<{ seat_id: string; created_at: string }>()
  if (!session) return null
  if (Date.now() - Date.parse(session.created_at) > SESSION_MAX_AGE_MS) {
    await db.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run()
    return null
  }
  return (await getRow(db, 'seats', session.seat_id)) as Seat | null
}

/** Applies a seat write coming from the client: hashes a new password if given,
 * and never lets passwordHash/salt be set directly. */
async function prepareSeatData(body: Rec, existing?: Rec): Promise<Rec> {
  const { password, passwordHash: _ph, salt: _s, ...fields } = body as Rec & { password?: string }
  const data: Rec = { ...(existing ?? {}), ...fields }
  if (typeof body.username === 'string') data.username = (body.username as string).trim().toLowerCase()
  if (password) {
    const salt = randomHex(8)
    data.salt = salt
    data.passwordHash = await sha256hex(`${salt}:${password}`)
  }
  return data
}

export const onRequest: PagesFunction<Env> = async (ctx) => {
  const { request, env } = ctx
  const db = env.DB
  const url = new URL(request.url)
  const parts = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean)
  const method = request.method.toUpperCase()

  try {
    // ---- auth endpoints ----------------------------------------------------
    if (parts[0] === 'login' && method === 'POST') {
      const body = (await request.json()) as { username?: string; password?: string }
      const uname = (body.username ?? '').trim().toLowerCase()
      const seats = (await tableRows(db, 'seats')) as Seat[]
      const seat = seats.find((s) => s.username.toLowerCase() === uname)
      if (!seat || (await sha256hex(`${seat.salt}:${body.password ?? ''}`)) !== seat.passwordHash) {
        return err(401, 'Wrong username or password.')
      }
      const token = randomHex(32)
      await db.prepare('INSERT INTO sessions (token, seat_id, created_at) VALUES (?, ?, ?)').bind(token, seat.id, now()).run()
      await audit.record(db, { seat, action: 'login', tbl: 'seats', recordId: seat.id })
      return json({ token, seat: stripSeat(seat) })
    }

    if (parts[0] === 'logout' && method === 'POST') {
      const header = request.headers.get('authorization') ?? ''
      const token = header.startsWith('Bearer ') ? header.slice(7) : ''
      if (token) await db.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run()
      return json({ ok: true })
    }

    if (parts[0] === 'status' && method === 'GET') {
      const seats = await db.prepare("SELECT COUNT(*) AS n FROM records WHERE tbl = 'seats'").first<{ n: number }>()
      const records = await db.prepare("SELECT COUNT(*) AS n FROM records WHERE tbl != 'seats'").first<{ n: number }>()
      return json({ seats: seats?.n ?? 0, records: records?.n ?? 0 })
    }

    // ---- everything below requires a valid session -------------------------
    const me = await authSeat(request, db)
    if (!me) return err(401, 'Not signed in.')

    if (parts[0] === 'me' && method === 'GET') return json(stripSeat(me))

    // ---- infrastructure endpoints ------------------------------------------
    // Read/write predicates shared with the attachment layer, so a document
    // inherits exactly the guard of the record it belongs to.
    const canReadTable = (tbl: string) => {
      if (me.isAdmin) return true
      if (HR_TABLES.has(tbl) || tbl === 'personnel') return canHr(me)
      const mod = TABLE_MODULE[tbl]
      return !mod || (me.modules ?? []).includes(mod)
    }
    const canWriteTable = (tbl: string) => {
      if (me.isAdmin) return true
      if (tbl === 'seats') return false
      if (HR_ADMIN_WRITE.has(tbl)) return false
      if (HR_TABLES.has(tbl) || tbl === 'personnel') return canHr(me)
      const mod = TABLE_MODULE[tbl]
      return !mod || (me.modules ?? []).includes(mod)
    }

    if (parts[0] === 'attachments') {
      const res = await attachments.handleAttachments(env, parts, method, url, request, me, {
        read: canReadTable,
        write: canWriteTable,
      })
      if (res) return res
      return err(405, 'Method not allowed.')
    }

    if (parts[0] === 'audit' && method === 'GET') return audit.handleAudit(db, url, me)

    if (parts[0] === 'approvals') {
      const res = await approvals.handleApprovals(db, parts, method, url, request, me)
      if (res) return res
      return err(405, 'Method not allowed.')
    }

    if (parts[0] === 'notifications') {
      const res = await notifications.handleNotifications(db, parts, method, url, request, me)
      if (res) return res
      return err(405, 'Method not allowed.')
    }

    if (parts[0] === 'refs') {
      const res = await handleRefs(db, parts, method, me)
      if (res) return res
      return err(405, 'Method not allowed.')
    }

    if (parts[0] === 'import' && method === 'POST') {
      if (!me.isAdmin) return err(403, 'Admin only.')
      const body = (await request.json()) as { tables?: Record<string, Rec[]>; mode?: string }
      const stmts: D1PreparedStatement[] = []
      if (body.mode === 'replace') {
        stmts.push(db.prepare("DELETE FROM records WHERE tbl != 'seats'"))
      }
      const existingSeats = (await tableRows(db, 'seats')) as Seat[]
      let imported = 0
      for (const [tbl, rows] of Object.entries(body.tables ?? {})) {
        if (!TABLES.has(tbl) || !Array.isArray(rows)) continue
        for (const row of rows) {
          if (!row || typeof row.id !== 'string') continue
          if (tbl === 'seats') {
            // Merge by username so the bootstrap admin (or an already-imported seat)
            // isn't duplicated - the incoming seat's password/hash wins, the id stays,
            // so existing sessions keep working.
            const uname = String(row.username ?? '').toLowerCase()
            const clash = existingSeats.find((s) => s.username.toLowerCase() === uname)
            const rec = clash ? { ...row, id: clash.id } : row
            stmts.push(putStmt(db, tbl, rec))
          } else {
            stmts.push(putStmt(db, tbl, row))
          }
          imported++
        }
      }
      // D1 batches are capped; chunk to stay well under the limit.
      for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50))
      // An import can move stock anywhere, so check every threshold.
      await stock.checkThresholds(db)
      await audit.record(db, {
        seat: me, action: 'create', tbl: 'import', recordId: '-',
        summary: `imported ${imported} records${body.mode === 'replace' ? ' (replacing existing data)' : ''}`,
      })
      return json({ ok: true, imported })
    }

    // ---- generic table CRUD ------------------------------------------------
    const [tbl, id] = parts
    if (!tbl || !TABLES.has(tbl)) return err(404, 'Unknown resource.')
    const isSeats = tbl === 'seats'

    if (HR_TABLES.has(tbl) && !canHr(me)) return err(403, 'This needs HR access on your seat.')
    const hidePay = tbl === 'personnel' && !canHr(me)

    if (method === 'GET') {
      if (id) {
        const row = await getRow(db, tbl, id)
        if (!row) return err(404, 'Not found.')
        // 404 rather than 403: a private note's existence is itself private.
        if (OWN_SEAT_TABLES.has(tbl) && row.seatId !== me.id) return err(404, 'Not found.')
        return json(isSeats ? stripSeat(row) : hidePay ? stripPersonnel(row) : row)
      }
      const rows = await tableRows(db, tbl)
      if (OWN_SEAT_TABLES.has(tbl)) return json(rows.filter((r) => r.seatId === me.id))
      return json(isSeats ? rows.map(stripSeat) : hidePay ? rows.map(stripPersonnel) : rows)
    }

    // Module access, finally enforced on the record and not just on its
    // attachments. Everything below this line is a stricter rule layered on
    // top; this is the one that was missing entirely. Reads are deliberately
    // not gated - see server/access.ts for why.
    if (!canWriteRecord(me, tbl)) return err(403, 'Your seat does not have access to this module.')
    if (ADMIN_WRITE_TABLES.has(tbl) && !me.isAdmin) return err(403, 'Only admins can change System configuration.')
    // Low supply warning setup (2.3). The Stock page hides this behind an
    // isAdmin check, but that is a client-side courtesy - without this line any
    // seat could raise, lower, disable or delete a warning through the API and
    // nobody would be told the depot had stopped being watched.
    if (tbl === 'stockThresholds' && !me.isAdmin) return err(403, 'Only admins can change stock warning levels.')
    // Announcement board (2.4). Posting has always been admin-only in the UI and
    // was never enforced anywhere else, so any seat could post, edit or delete
    // from the board everyone reads. Editing and deleting make that worse, so
    // the guard lands with them.
    if (tbl === 'announcements' && !me.isAdmin) return err(403, 'Only admins can post to the announcement board.')
    if (isSeats && !me.isAdmin) return err(403, 'Only admins can manage seats.')
    if (tbl === 'personnel' && !canHr(me)) return err(403, 'Employee records are managed in HR.')
    if (HR_ADMIN_WRITE.has(tbl) && !me.isAdmin) return err(403, 'Only admins can change HR setup.')

    if (method === 'POST' && !id) {
      const body = (await request.json()) as Rec
      delete body.id
      delete body.createdAt
      delete body.updatedAt
      const problems = validateRecord(tbl, body, 'create')
      if (problems.length) return err(400, problems[0].message)
      const t = now()
      let data: Rec = { ...body, id: newId(), createdAt: t, updatedAt: t }
      // Ignore any seatId the client sent - you can only create your own.
      if (OWN_SEAT_TABLES.has(tbl)) data = { ...data, seatId: me.id }
      if (isSeats) {
        data = await prepareSeatData(data)
        const seats = (await tableRows(db, 'seats')) as Seat[]
        if (seats.some((s) => s.username.toLowerCase() === String(data.username).toLowerCase())) {
          return err(409, 'That username is already taken.')
        }
        if (!data.passwordHash) return err(400, 'New seats need a password.')
      }
      // Secondary Feature 2.1 - park it instead of posting it.
      if (approvals.needsApproval(tbl, me, await approvals.loadRules(db), data)) {
        return approvals.submit(db, me, tbl, 'create', String(data.id), data)
      }
      await putStmt(db, tbl, data).run()
      await audit.record(db, { seat: me, action: 'create', tbl, recordId: String(data.id), after: data })
      // Secondary Feature 2.3 - this write may have taken a warehouse below its
      // warning level.
      if (stock.STOCK_TABLES.has(tbl)) {
        for (const w of await stock.affectedWarehouses(db, tbl, String(data.id), data)) await stock.checkThresholds(db, w)
      }
      return json(isSeats ? stripSeat(data) : data)
    }

    if (method === 'PUT' && id) {
      const existing = await getRow(db, tbl, id)
      if (!existing) return err(404, 'Not found.')
      // You may only edit your own, and you may not hand it to someone else.
      if (OWN_SEAT_TABLES.has(tbl) && existing.seatId !== me.id) return err(404, 'Not found.')
      if (tbl === 'payrollRuns' && existing.status === 'finalized' && !me.isAdmin) {
        return err(409, 'This payroll run is finalized. Only an admin can reopen it.')
      }
      const body = (await request.json()) as Rec
      const problems = validateRecord(tbl, body, 'update')
      if (problems.length) return err(400, problems[0].message)
      delete body.id
      delete body.createdAt
      let data: Rec = { ...existing, ...body, id, updatedAt: now() }
      if (isSeats) {
        data = { ...(await prepareSeatData(body, existing)), id, updatedAt: now() }
        const seats = (await tableRows(db, 'seats')) as Seat[]
        if (seats.some((s) => s.id !== id && s.username.toLowerCase() === String(data.username).toLowerCase())) {
          return err(409, 'That username is already taken.')
        }
        // Demoting the last admin would lock seat management forever.
        if ((existing as Seat).isAdmin && data.isAdmin === false && !seats.some((s) => s.isAdmin && s.id !== id)) {
          return err(409, 'This is the only admin seat - make another seat admin first.')
        }
      }
      if (OWN_SEAT_TABLES.has(tbl)) data = { ...data, seatId: existing.seatId }
      if (approvals.needsApproval(tbl, me, await approvals.loadRules(db), data)) {
        return approvals.submit(db, me, tbl, 'update', id, body)
      }
      await putStmt(db, tbl, data).run()
      await audit.record(db, { seat: me, action: 'update', tbl, recordId: id, before: existing, after: data })
      if (stock.STOCK_TABLES.has(tbl)) {
        for (const w of await stock.affectedWarehouses(db, tbl, id, data)) await stock.checkThresholds(db, w)
      }
      return json(isSeats ? stripSeat(data) : data)
    }

    if (method === 'DELETE' && id) {
      if (OWN_SEAT_TABLES.has(tbl)) {
        const owned = await getRow(db, tbl, id)
        if (!owned || owned.seatId !== me.id) return err(404, 'Not found.')
      }
      if (tbl === 'payrollRuns') {
        const existing = await getRow(db, tbl, id)
        if (existing?.status === 'finalized' && !me.isAdmin) {
          return err(409, 'This payroll run is finalized. Only an admin can delete it.')
        }
      }
      if (isSeats) {
        if (id === me.id) return err(409, 'You can’t delete the seat you’re signed in with.')
        const seats = (await tableRows(db, 'seats')) as Seat[]
        const victim = seats.find((s) => s.id === id)
        if (victim?.isAdmin && !seats.some((s) => s.isAdmin && s.id !== id)) {
          return err(409, 'This is the only admin seat - make another seat admin first.')
        }
        await db.prepare('DELETE FROM sessions WHERE seat_id = ?').bind(id).run()
      }
      const before = await getRow(db, tbl, id)
      if (approvals.needsApproval(tbl, me, await approvals.loadRules(db), before ?? {})) {
        return approvals.submit(db, me, tbl, 'delete', id, before ?? {})
      }
      await db.prepare('DELETE FROM records WHERE tbl = ? AND id = ?').bind(tbl, id).run()
      // A record's uploaded documents don't outlive the record.
      await attachments.removeFor(env, tbl, id)
      await audit.record(db, { seat: me, action: 'delete', tbl, recordId: id, before })
      if (stock.STOCK_TABLES.has(tbl)) {
        await stock.checkThresholds(db, { warehouseId: before?.warehouseId as string | undefined })
      }
      return json({ ok: true })
    }

    return err(405, 'Method not allowed.')
  } catch (e) {
    if (e instanceof SyntaxError) return err(400, 'Invalid JSON body.')
    return err(500, e instanceof Error ? e.message : 'Server error.')
  }
}
