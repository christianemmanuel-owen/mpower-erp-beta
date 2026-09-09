/// <reference types="@cloudflare/workers-types" />
// Staff input history - Secondary Feature 2.2.
//
// Every write that reaches the API is recorded here with who did it, what
// changed, and a one-line summary an administrator can scan. The log is
// append-only: there is no update or delete endpoint, deliberately, because a
// history a user can edit is not a history.

import { json, now, paging, type Rec, type Seat } from './core'

export type AuditAction =
  | 'create' | 'update' | 'delete'
  | 'submit' | 'approve' | 'reject' | 'amend'
  | 'upload' | 'remove_file'
  | 'login'

/** Fields that must never be written into the log, whatever the table. */
const REDACTED = new Set(['password', 'passwordHash', 'salt'])

/** Compares two records field-by-field, returning only what actually changed.
 * Values are compared by JSON shape so nested objects (govIds, installments)
 * are handled without a deep-equal dependency. */
export function diff(before: Rec, after: Rec): Record<string, [unknown, unknown]> {
  const changes: Record<string, [unknown, unknown]> = {}
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  for (const key of keys) {
    if (REDACTED.has(key) || key === 'updatedAt') continue
    const a = JSON.stringify(before[key] ?? null)
    const b = JSON.stringify(after[key] ?? null)
    if (a !== b) changes[key] = [before[key] ?? null, after[key] ?? null]
  }
  return changes
}

/** One-line description an administrator can read without opening the record. */
function describe(action: AuditAction, tbl: string, rec: Rec | null): string {
  const label =
    (rec?.company as string) ??
    (rec?.name as string) ??
    (rec?.plateNumber as string) ??
    (rec?.referenceNo as string) ??
    (rec?.id as string) ??
    ''
  const verb: Record<AuditAction, string> = {
    create: 'created', update: 'edited', delete: 'deleted',
    submit: 'submitted for approval', approve: 'approved', reject: 'rejected',
    amend: 'changed a pending', 
    upload: 'uploaded a document to', remove_file: 'removed a document from',
    login: 'signed in',
  }
  return `${verb[action]} ${singular(tbl)}${label ? ` ${label}` : ''}`.trim()
}

function singular(tbl: string) {
  if (tbl.endsWith('ies')) return `${tbl.slice(0, -3)}y`
  if (tbl.endsWith('s')) return tbl.slice(0, -1)
  return tbl
}

export interface AuditInput {
  seat: Pick<Seat, 'id' | 'name'>
  action: AuditAction
  tbl: string
  recordId: string
  before?: Rec | null
  after?: Rec | null
  summary?: string
}

/** Writes one audit row. Never throws into the caller's path: an audit failure
 * must not turn a successful business write into a 500 the user sees. */
export async function record(db: D1Database, input: AuditInput): Promise<void> {
  const changes =
    input.action === 'update' && input.before && input.after
      ? JSON.stringify(diff(input.before, input.after))
      : null
  const summary = input.summary ?? describe(input.action, input.tbl, input.after ?? input.before ?? null)
  try {
    await db
      .prepare(
        'INSERT INTO audit_log (at, seat_id, seat_name, action, tbl, record_id, summary, changes) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(now(), input.seat.id, input.seat.name, input.action, input.tbl, input.recordId, summary, changes)
      .run()
  } catch {
    // Swallowed on purpose - see the doc comment above.
  }
}

export interface AuditRow {
  id: number
  at: string
  seatId: string
  seatName: string
  action: string
  tbl: string
  recordId: string
  summary: string | null
  changes: Record<string, [unknown, unknown]> | null
}

/**
 * GET /api/audit - the review screen behind 2.2.
 *   ?seat=<id>      one staff member's inputs
 *   ?tbl=&record=   one record's full history
 *   ?action=        filter by action
 *   ?since=&until=  ISO bounds
 *   ?limit=&offset= paging (default 100, max 500)
 *
 * Administrators see everything; anyone else sees only their own inputs, so a
 * seat can check its own history without being able to audit colleagues.
 */
export async function handleAudit(db: D1Database, url: URL, me: Seat): Promise<Response> {
  const where: string[] = []
  const binds: unknown[] = []

  const seat = url.searchParams.get('seat')
  if (me.isAdmin) {
    if (seat) { where.push('seat_id = ?'); binds.push(seat) }
  } else {
    where.push('seat_id = ?')
    binds.push(me.id)
  }

  const tbl = url.searchParams.get('tbl')
  if (tbl) { where.push('tbl = ?'); binds.push(tbl) }
  const recordId = url.searchParams.get('record')
  if (recordId) { where.push('record_id = ?'); binds.push(recordId) }
  const action = url.searchParams.get('action')
  if (action) { where.push('action = ?'); binds.push(action) }
  const since = url.searchParams.get('since')
  if (since) { where.push('at >= ?'); binds.push(since) }
  const until = url.searchParams.get('until')
  if (until) { where.push('at <= ?'); binds.push(until) }

  const { limit, offset } = paging(url)
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const { results } = await db
    .prepare(`SELECT * FROM audit_log ${clause} ORDER BY at DESC, id DESC LIMIT ? OFFSET ?`)
    .bind(...binds, limit, offset)
    .all<{
      id: number; at: string; seat_id: string; seat_name: string; action: string
      tbl: string; record_id: string; summary: string | null; changes: string | null
    }>()

  const rows: AuditRow[] = results.map((r) => ({
    id: r.id,
    at: r.at,
    seatId: r.seat_id,
    seatName: r.seat_name,
    action: r.action,
    tbl: r.tbl,
    recordId: r.record_id,
    summary: r.summary,
    changes: r.changes ? (JSON.parse(r.changes) as Record<string, [unknown, unknown]>) : null,
  }))
  return json({ rows, limit, offset })
}
