/// <reference types="@cloudflare/workers-types" />
// Document reference numbers (Exhibit A 1.2, 1.3, 1.5, 1.6).
//
// Several Exhibit A documents carry a reference number: the purchase order to
// the supplier, the purchase order from the client, delivery receipts, loading
// slips, pre-dispatch checklists, collection forms. Some of those numbers come
// from outside (the client's own PO number is whatever the client wrote on it);
// others MPower issues itself. This module issues the latter.
//
// Numbers are allocated with a single UPDATE ... RETURNING inside D1, so two
// requests racing for the next number can never receive the same one.

import { json, type Seat } from './core'

export interface Series {
  code: string
  label: string
  /** '' never resets, 'yyyy' resets each year, 'yyyy-MM' each month. */
  reset: '' | 'yyyy' | 'yyyy-MM'
  pad: number
}

/** The series MPower issues itself. Externally-supplied numbers (the client's
 * PO, the supplier's DR) are typed in by staff and are not allocated here. */
export const SERIES: Record<string, Series> = {
  PO: { code: 'PO', label: 'Purchase order to supplier', reset: 'yyyy', pad: 5 },
  DR: { code: 'DR', label: 'Delivery receipt', reset: 'yyyy', pad: 5 },
  LS: { code: 'LS', label: 'Loading slip', reset: 'yyyy', pad: 5 },
  PDC: { code: 'PDC', label: 'Pre-dispatch checklist', reset: 'yyyy', pad: 5 },
  CF: { code: 'CF', label: 'Collection form', reset: 'yyyy', pad: 5 },
  IR: { code: 'IR', label: 'Internal receipt', reset: 'yyyy', pad: 5 },
}

function periodFor(reset: Series['reset'], date = new Date()): string {
  if (reset === '') return '-'
  const y = date.getUTCFullYear()
  if (reset === 'yyyy') return String(y)
  return `${y}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

/** Allocates and returns the next number in a series, e.g. "PO-2026-00041". */
export async function allocate(db: D1Database, code: string): Promise<string> {
  const series = SERIES[code]
  if (!series) throw new Error(`Unknown reference series "${code}".`)
  const period = periodFor(series.reset)

  // Seed the row if this is the first number of the period, then take one.
  await db
    .prepare('INSERT OR IGNORE INTO counters (series, period, next) VALUES (?, ?, 1)')
    .bind(series.code, period)
    .run()
  const row = await db
    .prepare('UPDATE counters SET next = next + 1 WHERE series = ? AND period = ? RETURNING next')
    .bind(series.code, period)
    .first<{ next: number }>()

  // RETURNING gives the value after the increment, so the number we just took
  // is one less.
  const n = (row?.next ?? 2) - 1
  const body = String(n).padStart(series.pad, '0')
  return period === '-' ? `${series.code}-${body}` : `${series.code}-${period}-${body}`
}

/**
 * Routes under /api/refs:
 *   GET  /api/refs                → the configured series
 *   POST /api/refs/:code          → { referenceNo }   allocates the next number
 *
 * Allocation is a POST because it mutates: refreshing a GET must never burn a
 * number and leave a gap in the books.
 */
export async function handleRefs(
  db: D1Database,
  parts: string[],
  method: string,
  _me: Seat,
): Promise<Response | null> {
  if (parts.length === 1 && method === 'GET') return json({ series: Object.values(SERIES) })

  if (parts.length === 2 && method === 'POST') {
    const code = parts[1].toUpperCase()
    if (!SERIES[code]) return json({ error: `Unknown reference series "${code}".` }, 404)
    return json({ referenceNo: await allocate(db, code) })
  }

  return null
}
