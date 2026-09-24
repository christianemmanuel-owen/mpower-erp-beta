/// <reference types="@cloudflare/workers-types" />
// Shared server primitives - the bindings, the record helpers, and the small
// utilities every other server module builds on.
//
// Lives outside `functions/` on purpose: everything inside `functions/` is a
// route, these are modules the route imports.

export interface Env {
  DB: D1Database
  /** Uploaded digital copies. Optional so local dev without an R2 binding still
   * boots - the attachment endpoints return a clear 503 instead of crashing. */
  DOCS?: R2Bucket
  /** Turns on Google routing for drive-time estimates; without it the free
   * OSRM server is used. See server/routing.ts. */
  GOOGLE_MAPS_API_KEY?: string
}

export type Rec = Record<string, unknown>

export interface Seat extends Rec {
  id: string
  name: string
  username: string
  passwordHash: string
  salt: string
  isAdmin: boolean
  modules?: string[]
  /** May approve pending inputs (Secondary Feature 2.1). Admins always may. */
  canApprove?: boolean
  /** Writes post directly instead of parking for approval. */
  bypassApproval?: boolean
  /** The Personnel record this login is - see src/data/types.ts. Field seats
   *  carry it; office seats do not. */
  personnelId?: string
  /** 'own' means a field seat: their trips, their sales, their collections,
   *  enforced in server/scope.ts. Blank or 'all' is the office. */
  scope?: 'own' | 'all'
  /** Resolved from the seat's Personnel row when the session loads, so a sale's
   *  agentId can be matched against the person signing in. Never stored. */
  agentId?: string
}

export const now = () => new Date().toISOString()

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export const err = (status: number, message: string) => json({ error: message }, status)

export async function sha256hex(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function randomHex(bytes: number) {
  const buf = crypto.getRandomValues(new Uint8Array(bytes))
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Same alphabet/length as the client's old nanoid(10) ids, so records mix cleanly. */
export function newId() {
  const alphabet = 'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict'
  const buf = crypto.getRandomValues(new Uint8Array(10))
  return [...buf].map((b) => alphabet[b & 63]).join('')
}

export async function tableRows(db: D1Database, tbl: string): Promise<Rec[]> {
  const { results } = await db
    .prepare('SELECT data FROM records WHERE tbl = ?')
    .bind(tbl)
    .all<{ data: string }>()
  return results.map((r) => JSON.parse(r.data) as Rec)
}

export async function getRow(db: D1Database, tbl: string, id: string): Promise<Rec | null> {
  const row = await db
    .prepare('SELECT data FROM records WHERE tbl = ? AND id = ?')
    .bind(tbl, id)
    .first<{ data: string }>()
  return row ? (JSON.parse(row.data) as Rec) : null
}

export function putStmt(db: D1Database, tbl: string, rec: Rec) {
  return db
    .prepare(
      'INSERT INTO records (tbl, id, data, updated_at) VALUES (?, ?, ?, ?) ' +
        'ON CONFLICT (tbl, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at',
    )
    .bind(tbl, String(rec.id), JSON.stringify(rec), now())
}

/** Parses `?limit=` / `?offset=` with sane caps so a bad client can't ask for
 * the whole audit log at once. */
export function paging(url: URL, defaultLimit = 100, maxLimit = 500) {
  const limit = Math.min(maxLimit, Math.max(1, Number(url.searchParams.get('limit')) || defaultLimit))
  const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0)
  return { limit, offset }
}
