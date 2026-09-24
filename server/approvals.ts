/// <reference types="@cloudflare/workers-types" />
// Approval-based inputs - Secondary Feature 2.1.
//
// "Staff-entered records, for example purchase orders and client sales, enter a
// pending state and require an administrator's approval before being confirmed
// and posted to the System."
//
// The important design choice: a pending record is NOT written into `records`.
// If it were, every read path in the app (stock on hand, receivables, quota
// attainment) would silently count unapproved data, and each of them would have
// to learn to filter. Instead the proposed write is parked in `approvals` and
// only lands in `records` when someone approves it. Reads stay untouched, and
// "pending" can never contaminate a number the Client acts on.

import { err, getRow, json, newId, now, paging, putStmt, type Rec, type Seat } from './core'
import { validateRecord } from './validate'
import * as audit from './audit'
import * as notifications from './notifications'
import * as stock from './stock'
import { fulfilOnDelivery } from './fulfilment'

/**
 * Which tables need approval - Secondary Feature 2.1.
 *
 * Exhibit A names purchase orders and client sales "for example", not as the
 * exhaustive list, so the answer will change. Rather than hard-code it, the rule
 * lives in a settings record an administrator edits: adding a table later is a
 * tick-box, not a redeploy. The two named examples are the default, which is
 * what a database with no settings record yet gets.
 *
 * Deliberately simple for now. `minAmount` is the one obvious next axis (approve
 * only above some peso value) and is read and honoured here already, but nothing
 * sets it - there is no threshold in Exhibit A and guessing one would be worse
 * than leaving it open.
 */
export const DEFAULT_APPROVAL_TABLES = ['purchases', 'sales'] as const

/** Tables that may sensibly be put under approval. Deliberately excludes `seats`
 * (only admins can write those anyway, so an approval step would be circular)
 * and the HR setup tables (already admin-only). */
export const APPROVABLE_TABLES = [
  'purchases', 'sales', 'deliveries', 'customers', 'suppliers',
  'personnel', 'trucks', 'supplierQuotes', 'payrollRuns',
] as const

export interface ApprovalRules {
  tables: string[]
  /** Only require approval above this order value. 0 or absent = always require
   * it. Honoured by needsApproval, currently never set. */
  minAmount?: number
}

const SETTINGS_TBL = 'appSettings'
const SETTINGS_ID = 'approvals'

export const defaultRules = (): ApprovalRules => ({ tables: [...DEFAULT_APPROVAL_TABLES] })

/** Reads the configured rules, falling back to the Exhibit A defaults. Tolerates
 * a malformed record rather than failing every write in the System. */
export async function loadRules(db: D1Database): Promise<ApprovalRules> {
  const rec = await getRow(db, SETTINGS_TBL, SETTINGS_ID)
  const tables = (rec as { tables?: unknown } | null)?.tables
  if (!Array.isArray(tables)) return defaultRules()
  const clean = tables.filter((t): t is string => typeof t === 'string' && (APPROVABLE_TABLES as readonly string[]).includes(t))
  const minAmount = (rec as { minAmount?: unknown }).minAmount
  return { tables: clean, minAmount: typeof minAmount === 'number' ? minAmount : undefined }
}

export async function saveRules(db: D1Database, rules: ApprovalRules): Promise<ApprovalRules> {
  const clean: Rec = {
    id: SETTINGS_ID,
    tables: rules.tables.filter((t) => (APPROVABLE_TABLES as readonly string[]).includes(t)),
    minAmount: rules.minAmount ?? 0,
    updatedAt: now(),
  }
  await putStmt(db, SETTINGS_TBL, clean).run()
  return { tables: clean.tables as string[], minAmount: clean.minAmount as number }
}

/** The order value a rule threshold compares against, when the record has one. */
function amountOf(payload: Rec): number | null {
  const volume = payload.volumeLiters
  const price = payload.pricePerLiter
  if (typeof volume === 'number' && typeof price === 'number') return volume * price
  return null
}

/**
 * Does this write need parking?
 *
 * Admins never do - an administrator approving their own input is just a slower
 * way to save. Neither does a seat granted `canApprove`, nor one explicitly
 * marked `bypassApproval` (the trusted-encoder escape hatch).
 */
export function needsApproval(tbl: string, seat: Seat, rules: ApprovalRules, payload?: Rec): boolean {
  if (!rules.tables.includes(tbl)) return false
  if (seat.isAdmin || seat.canApprove === true || seat.bypassApproval === true) return false
  if (rules.minAmount && payload) {
    const amount = amountOf(payload)
    // A record with no value to compare always needs approval - failing open
    // here would let a mis-shaped payload skip the check entirely.
    if (amount !== null && amount < rules.minAmount) return false
  }
  return true
}

export const mayApprove = (seat: Seat) => seat.isAdmin || seat.canApprove === true

export type ApprovalAction = 'create' | 'update' | 'delete'

interface DbRow {
  id: string; tbl: string; record_id: string; action: string; status: string
  payload: string; summary: string | null
  requested_by: string; requested_by_name: string; requested_at: string
  decided_by: string | null; decided_by_name: string | null; decided_at: string | null
  decision_note: string | null
}

const toRow = (r: DbRow) => ({
  id: r.id,
  tbl: r.tbl,
  recordId: r.record_id,
  action: r.action as ApprovalAction,
  status: r.status,
  payload: JSON.parse(r.payload) as Rec,
  summary: r.summary,
  requestedBy: r.requested_by,
  requestedByName: r.requested_by_name,
  requestedAt: r.requested_at,
  decidedBy: r.decided_by,
  decidedByName: r.decided_by_name,
  decidedAt: r.decided_at,
  decisionNote: r.decision_note,
})

function describe(action: ApprovalAction, tbl: string, payload: Rec): string {
  const kind = tbl === 'purchases' ? 'purchase' : tbl === 'sales' ? 'sale' : tbl.replace(/s$/, '')
  const volume = typeof payload.volumeLiters === 'number' ? `${payload.volumeLiters.toLocaleString()} L` : ''
  const price = typeof payload.pricePerLiter === 'number' ? ` @ ₱${payload.pricePerLiter}/L` : ''
  const verb = action === 'create' ? 'New' : action === 'update' ? 'Edit to' : 'Deletion of'
  return `${verb} ${kind}${volume ? ` - ${volume}${price}` : ''}`
}

/**
 * Parks a proposed write and notifies the approvers. Returns the 202 body the
 * client shows as "sent for approval" - deliberately not a 200 with a record,
 * so a caller can't mistake a pending input for a posted one.
 */
export async function submit(
  db: D1Database,
  seat: Seat,
  tbl: string,
  action: ApprovalAction,
  recordId: string,
  payload: Rec,
): Promise<Response> {
  const id = newId()
  const summary = describe(action, tbl, payload)
  await db
    .prepare(
      'INSERT INTO approvals (id, tbl, record_id, action, status, payload, summary, requested_by, requested_by_name, requested_at) ' +
        "VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)",
    )
    .bind(id, tbl, recordId, action, JSON.stringify(payload), summary, seat.id, seat.name, now())
    .run()

  await audit.record(db, { seat, action: 'submit', tbl, recordId, summary })
  await notifications.emit(db, { admins: true }, {
    kind: 'approval_request',
    title: 'Waiting for approval',
    body: `${seat.name}: ${summary}`,
    link: '/settings/approvals',
    tbl,
    recordId,
  })

  return json(
    {
      pending: true,
      approvalId: id,
      summary,
      message: 'Sent for approval. It will post to the System once an administrator approves it.',
    },
    202,
  )
}

/**
 * Which fields an approver changed while this submission sat in the queue.
 *
 * Deliberately read back out of the audit log rather than kept in a column on
 * `approvals`. schema.sql is entirely IF NOT EXISTS and re-running it is how a
 * live database picks up new infrastructure - a plain ALTER TABLE would break
 * that, and this System has no migration runner to put one in. The amendments
 * are already written to the log with their full before/after, so the log is
 * the record; this just reads it. Bounded by the submission's own timestamp so
 * an earlier parked edit to the same record cannot leak in.
 */
async function amendedFields(db: D1Database, row: ReturnType<typeof toRow>): Promise<string[]> {
  const { results } = await db
    .prepare(
      "SELECT changes FROM audit_log WHERE action = 'amend' AND tbl = ? AND record_id = ? AND at >= ? ORDER BY at",
    )
    .bind(row.tbl, row.recordId, row.requestedAt)
    .all<{ changes: string | null }>()
  const fields = new Set<string>()
  for (const r of results) {
    if (!r.changes) continue
    try {
      for (const key of Object.keys(JSON.parse(r.changes) as Rec)) fields.add(key)
    } catch {
      // A malformed log row must not stop an approval going through.
    }
  }
  return [...fields]
}

/** Applies an approved write to `records`. Returns what was there before as
 * well as what is there now, so the approval's audit row carries the full
 * before/after - which is what an undo reads back. */
async function apply(db: D1Database, row: ReturnType<typeof toRow>): Promise<{ before: Rec | null; after: Rec | null }> {
  if (row.action === 'delete') {
    const before = await getRow(db, row.tbl, row.recordId)
    await db.prepare('DELETE FROM records WHERE tbl = ? AND id = ?').bind(row.tbl, row.recordId).run()
    return { before, after: null }
  }
  if (row.action === 'create') {
    await putStmt(db, row.tbl, row.payload).run()
    return { before: null, after: row.payload }
  }
  const existing = await getRow(db, row.tbl, row.recordId)
  if (!existing) return { before: null, after: null }
  const merged: Rec = { ...existing, ...row.payload, id: row.recordId, updatedAt: now() }
  await putStmt(db, row.tbl, merged).run()
  return { before: existing, after: merged }
}

/**
 * Undoing a decision - the approved write is reversed from the approval's own
 * audit row, which holds the field-level before/after of what it posted.
 *
 * Refused when anything else has touched the record since: an edit, an upload,
 * a later approval. Unwinding on top of someone's later work would replace it
 * with a guess, and the honest answer there is "undo it by hand".
 */
async function unapply(db: D1Database, row: ReturnType<typeof toRow>): Promise<string | null> {
  const approval = await db
    .prepare("SELECT id, at, changes FROM audit_log WHERE action = 'approve' AND tbl = ? AND record_id = ? AND at >= ? ORDER BY at DESC LIMIT 1")
    .bind(row.tbl, row.recordId, row.decidedAt ?? row.requestedAt)
    .first<{ id: number; at: string; changes: string | null }>()
  if (!approval) return 'The approval left no record of what it changed, so it can’t be undone automatically.'

  const later = await db
    .prepare("SELECT seat_name, action, at FROM audit_log WHERE tbl = ? AND record_id = ? AND at > ? AND action != 'reverse' ORDER BY at ASC LIMIT 1")
    .bind(row.tbl, row.recordId, approval.at)
    .first<{ seat_name: string; action: string; at: string }>()
  if (later) {
    return `${later.seat_name} ${later.action === 'upload' ? 'uploaded a document to' : later.action === 'delete' ? 'deleted' : 'edited'} this record after it was approved, so undo it by hand rather than over their work.`
  }

  let changes: Record<string, [unknown, unknown]> = {}
  try { changes = approval.changes ? JSON.parse(approval.changes) : {} } catch { changes = {} }

  if (row.action === 'create') {
    await db.prepare('DELETE FROM records WHERE tbl = ? AND id = ?').bind(row.tbl, row.recordId).run()
    return null
  }
  if (row.action === 'delete') {
    const restored: Rec = { id: row.recordId }
    for (const [k, [before]] of Object.entries(changes)) if (before !== null && before !== undefined) restored[k] = before
    restored.updatedAt = now()
    await putStmt(db, row.tbl, restored).run()
    return null
  }
  const current = await getRow(db, row.tbl, row.recordId)
  if (!current) return 'The record this approval changed is no longer there.'
  const restored: Rec = { ...current }
  for (const [k, [before]] of Object.entries(changes)) {
    if (before === null || before === undefined) delete restored[k]
    else restored[k] = before
  }
  restored.id = row.recordId
  restored.updatedAt = now()
  await putStmt(db, row.tbl, restored).run()
  return null
}

/**
 * Routes under /api/approvals:
 *   GET  /api/approvals            → { rows }   (?status=pending|approved|rejected, ?mine=1)
 *   PATCH /api/approvals/:id       { payload }  amend a parked submission (approver)
 *   POST /api/approvals/:id/approve  { note? }
 *   POST /api/approvals/:id/reject   { note? }
 *   POST /api/approvals/:id/reverse  { note? }   undo a decision (admin, or the approver who made it)
 *   DELETE /api/approvals/:id        withdraw your own pending request
 *   GET  /api/approvals/rules      → the configured rules + what's configurable
 *   PUT  /api/approvals/rules      { tables, minAmount? }   (admin)
 *
 * Anyone may list their own requests; only approvers see everyone's, and only
 * approvers can decide. An approver cannot approve their own submission unless
 * they are an admin - which is the point of the feature.
 */
export async function handleApprovals(
  db: D1Database,
  parts: string[],
  method: string,
  url: URL,
  request: Request,
  me: Seat,
): Promise<Response | null> {
  if (parts.length === 1 && method === 'GET') {
    const status = url.searchParams.get('status') ?? 'pending'
    const mine = url.searchParams.get('mine') === '1' || !mayApprove(me)
    const { limit, offset } = paging(url, 100, 300)
    const clause = mine ? 'AND requested_by = ?' : ''
    const binds: unknown[] = mine ? [status, me.id] : [status]
    const { results } = await db
      .prepare(`SELECT * FROM approvals WHERE status = ? ${clause} ORDER BY requested_at DESC LIMIT ? OFFSET ?`)
      .bind(...binds, limit, offset)
      .all<DbRow>()
    const pending = await db
      .prepare('SELECT COUNT(*) AS n FROM approvals WHERE status = ?')
      .bind('pending')
      .first<{ n: number }>()
    return json({ rows: results.map(toRow), pendingCount: mayApprove(me) ? pending?.n ?? 0 : 0 })
  }

  // Rules come before the :id lookup - 'rules' is a reserved path, not an id.
  if (parts[1] === 'rules') {
    if (method === 'GET') {
      return json({ rules: await loadRules(db), approvable: APPROVABLE_TABLES, defaults: DEFAULT_APPROVAL_TABLES })
    }
    if (method === 'PUT') {
      if (!me.isAdmin) return err(403, 'Only admins can change approval rules.')
      const body = (await request.json()) as Partial<ApprovalRules>
      const saved = await saveRules(db, {
        tables: Array.isArray(body.tables) ? body.tables : [],
        minAmount: typeof body.minAmount === 'number' ? body.minAmount : 0,
      })
      await audit.record(db, {
        seat: me, action: 'update', tbl: 'appSettings', recordId: 'approvals',
        summary: saved.tables.length
          ? `set approvals to apply to ${saved.tables.join(', ')}`
          : 'turned approvals off for every table',
      })
      return json({ rules: saved })
    }
    return null
  }

  const id = parts[1]
  if (!id) return null
  const found = await db.prepare('SELECT * FROM approvals WHERE id = ?').bind(id).first<DbRow>()
  if (!found) return err(404, 'That request isn’t here.')
  const row = toRow(found)

  /**
   * Amend a parked submission before deciding on it.
   *
   * An approver looking at a sale with the wrong depot on it had two options
   * before this: approve something they know is wrong and edit the record
   * afterwards, or reject it and make the submitter retype the whole thing. The
   * first loses the correction from the approval trail, the second is a round
   * trip for a typo.
   *
   * The submitter stays the submitter - `requested_by` is untouched, because
   * they are still the person who raised it. What the approver did is written
   * to the audit log as its own act, with the full before/after, and named to
   * the submitter when the input finally posts.
   */
  if (parts.length === 2 && method === 'PATCH') {
    if (!mayApprove(me)) return err(403, 'Only an approver can change a pending input.')
    if (row.status !== 'pending') return err(409, `This request was already ${row.status}.`)

    const body = (await request.json().catch(() => ({}))) as { payload?: Rec }
    if (!body.payload || typeof body.payload !== 'object') {
      return err(400, 'Send the fields to change as `payload`.')
    }

    // Merged, not replaced: the drawer sends the fields it edited, and a
    // payload that arrived without `id` or `createdAt` must not lose them.
    const merged: Rec = { ...row.payload, ...body.payload }
    const problems = validateRecord(row.tbl, merged, row.action === 'create' ? 'create' : 'update')
    if (problems.length > 0) {
      return json({ error: problems[0].message, problems }, 422)
    }

    const changes = audit.diff(row.payload, merged)
    if (Object.keys(changes).length === 0) return json({ ok: true, row: { ...row, payload: merged } })

    const summary = describe(row.action, row.tbl, merged)
    await db
      .prepare('UPDATE approvals SET payload = ?, summary = ? WHERE id = ?')
      .bind(JSON.stringify(merged), summary, id)
      .run()

    await audit.record(db, {
      seat: me,
      action: 'amend',
      tbl: row.tbl,
      recordId: row.recordId,
      before: row.payload,
      after: merged,
      summary: `changed ${Object.keys(changes).join(', ')} on ${row.requestedByName}’s ${row.summary ?? 'input'}`,
    })

    return json({ ok: true, row: { ...row, payload: merged, summary } })
  }

  const decision = parts[2]
  if ((decision === 'approve' || decision === 'reject') && method === 'POST') {
    if (!mayApprove(me)) return err(403, 'Only an approver can decide on pending inputs.')
    if (row.status !== 'pending') return err(409, `This request was already ${row.status}.`)
    if (row.requestedBy === me.id && !me.isAdmin) {
      return err(403, 'You can’t approve your own input - ask an administrator.')
    }
    const body = (await request.json().catch(() => ({}))) as { note?: string }
    const status = decision === 'approve' ? 'approved' : 'rejected'

    let applied: Rec | null = null
    let before: Rec | null = null
    if (decision === 'approve') {
      ;({ before, after: applied } = await apply(db, row))
      // The same consequence the direct PUT has: a delivery landing as
      // delivered closes out its sale, whoever approved it.
      if (row.tbl === 'deliveries') await fulfilOnDelivery(db, me, before, applied)
      // An approved purchase or sale is the moment the stock actually moves -
      // the submission didn't move it, so this is where 2.3 has to look.
      if (stock.STOCK_TABLES.has(row.tbl)) {
        await stock.checkThresholds(db, {
          warehouseId: (applied?.warehouseId ?? row.payload.warehouseId) as string | undefined,
        })
      }
    }

    await db
      .prepare('UPDATE approvals SET status = ?, decided_by = ?, decided_by_name = ?, decided_at = ?, decision_note = ? WHERE id = ?')
      .bind(status, me.id, me.name, now(), body.note ?? null, id)
      .run()

    // The approval row carries what it posted - before/after, or the whole
    // record for a create or delete - so the history shows it and an undo
    // can read it back.
    await audit.record(db, {
      seat: me,
      action: decision === 'approve' ? 'approve' : 'reject',
      tbl: row.tbl,
      recordId: row.recordId,
      before: decision === 'approve' ? before ?? {} : undefined,
      after: decision === 'approve' ? applied ?? {} : undefined,
      summary: `${decision === 'approve' ? 'approved' : 'rejected'} ${row.requestedByName}’s ${row.summary ?? 'input'}`,
    })
    // If an approver corrected it on the way through, the record that just
    // posted under this person's name is not the one they typed. Say so, and
    // say which fields - otherwise they find out by noticing, or never.
    const amended = decision === 'approve' ? await amendedFields(db, row) : []
    const amendNote = amended.length > 0
      ? ` Changed before approval: ${amended.join(', ')}.`
      : ''

    await notifications.emit(db, { seatIds: [row.requestedBy] }, {
      kind: 'approval_result',
      title: decision === 'approve' ? 'Your input was approved' : 'Your input was not approved',
      body: `${row.summary ?? 'Your input'}${body.note ? ` - ${body.note}` : ''}${amendNote}`,
      link: `/${row.tbl === 'purchases' ? 'inventory' : row.tbl}`,
      tbl: row.tbl,
      recordId: row.recordId,
    })

    return json({ ok: true, status, record: applied })
  }

  /**
   * Undo a decision made by mistake. The request goes back to the queue as if
   * it had never been decided; an approved write is unwound (see unapply).
   * Admins may undo any decision; another approver only their own.
   */
  if (decision === 'reverse' && method === 'POST') {
    if (!mayApprove(me)) return err(403, 'Only an approver can undo a decision.')
    if (row.status === 'pending') return err(409, 'This request hasn’t been decided yet.')
    if (row.decidedBy !== me.id && !me.isAdmin) return err(403, 'Only the approver who decided this, or an administrator, can undo it.')
    const body = (await request.json().catch(() => ({}))) as { note?: string }

    if (row.status === 'approved') {
      const problem = await unapply(db, row)
      if (problem) return err(409, problem)
      if (stock.STOCK_TABLES.has(row.tbl)) {
        await stock.checkThresholds(db, { warehouseId: row.payload.warehouseId as string | undefined })
      }
    }

    await db
      .prepare('UPDATE approvals SET status = ?, decided_by = NULL, decided_by_name = NULL, decided_at = NULL, decision_note = ? WHERE id = ?')
      .bind('pending', body.note ?? null, id)
      .run()

    await audit.record(db, {
      seat: me,
      action: 'reverse',
      tbl: row.tbl,
      recordId: row.recordId,
      summary: `undid ${row.decidedByName === me.name ? 'their' : `${row.decidedByName}’s`} ${row.status === 'approved' ? 'approval' : 'rejection'} of ${row.requestedByName}’s ${row.summary ?? 'input'}${body.note ? ` - ${body.note}` : ''}`,
    })

    await notifications.emit(db, { seatIds: [row.requestedBy] }, {
      kind: 'approval_result',
      title: 'A decision on your input was undone',
      body: `${row.summary ?? 'Your input'} is back in the queue${body.note ? ` - ${body.note}` : ''}.`,
      link: '/settings/approvals',
      tbl: row.tbl,
      recordId: row.recordId,
    })

    return json({ ok: true, status: 'pending' })
  }

  if (parts.length === 2 && method === 'DELETE') {
    if (row.requestedBy !== me.id && !me.isAdmin) return err(403, 'That isn’t your request.')
    if (row.status !== 'pending') return err(409, `This request was already ${row.status}.`)
    await db.prepare('DELETE FROM approvals WHERE id = ?').bind(id).run()
    return json({ ok: true })
  }

  return null
}
