/// <reference types="@cloudflare/workers-types" />
// Notifications - Secondary Feature 2.11, and the delivery channel Secondary
// Features 2.3 (low supply), 2.4 (announcements) and 2.9 (smart lock) all use.
//
// Two halves:
//   - the in-app inbox, which works today and needs nothing external, and
//   - browser Web Push, which needs VAPID keys the Client has not supplied yet.
// The push half sits behind PushChannel below so it can be filled in without
// touching any caller - the same pattern the codebase already uses for
// TrackingProvider.

import { json, newId, now, paging, tableRows, type Seat } from './core'

export type NotificationKind =
  | 'low_stock'
  | 'announcement'
  | 'approval_request'
  | 'approval_result'
  | 'input_logged'
  | 'collection_due'
  | 'smart_lock'
  | 'system'

export interface Notify {
  kind: NotificationKind
  title: string
  body?: string
  /** In-app route to open on click, e.g. '/inventory'. */
  link?: string
  tbl?: string
  recordId?: string
}

export interface Recipients {
  /** Specific seat ids. */
  seatIds?: string[]
  /** Every seat granted this module. */
  module?: string
  /** Every admin seat. */
  admins?: boolean
  /** Everyone. */
  all?: boolean
}

/**
 * Browser push delivery. Deliberately unimplemented: Web Push requires a VAPID
 * key pair and the signing that goes with it, and pushing without the Client's
 * keys would just fail silently at runtime.
 *
 * To enable: generate a VAPID pair, add the public key to the client's service
 * worker registration and the private key as a Pages secret, then implement
 * `send` here (sign a JWT for the endpoint's origin, encrypt the payload per
 * RFC 8291, POST to the endpoint). Nothing else changes - emit() already calls
 * this for every notification it writes.
 */
export interface PushChannel {
  send(subscriptions: PushSubscriptionRow[], n: Notify): Promise<void>
}

export interface PushSubscriptionRow {
  endpoint: string
  seatId: string
  p256dh: string
  auth: string
}

/** No-op channel used until VAPID keys are configured. */
export const noPush: PushChannel = { async send() { /* not configured */ } }

let pushChannel: PushChannel = noPush
export const setPushChannel = (c: PushChannel) => { pushChannel = c }

/** Resolves a recipient spec to concrete seat ids. */
async function resolve(db: D1Database, to: Recipients): Promise<string[]> {
  const ids = new Set<string>(to.seatIds ?? [])
  if (to.all || to.module || to.admins) {
    const seats = (await tableRows(db, 'seats')) as unknown as Seat[]
    for (const s of seats) {
      if (to.all) ids.add(s.id)
      else if (to.admins && s.isAdmin) ids.add(s.id)
      else if (to.module && (s.isAdmin || (s.modules ?? []).includes(to.module))) ids.add(s.id)
    }
  }
  return [...ids]
}

/**
 * Fans a notification out to its recipients and hands it to the push channel.
 * Fan-out (one row per recipient) rather than a broadcast row keeps "my unread
 * count" a single indexed read; at this seat count the write cost is trivial.
 * Returns the group id tying the fan-out together.
 */
export async function emit(db: D1Database, to: Recipients, n: Notify): Promise<string> {
  const seatIds = await resolve(db, to)
  const groupId = newId()
  if (seatIds.length === 0) return groupId

  const at = now()
  const stmt = db.prepare(
    'INSERT INTO notifications (id, group_id, seat_id, kind, title, body, link, tbl, record_id, created_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
  const batch = seatIds.map((seatId) =>
    stmt.bind(newId(), groupId, seatId, n.kind, n.title, n.body ?? null, n.link ?? null, n.tbl ?? null, n.recordId ?? null, at),
  )
  for (let i = 0; i < batch.length; i += 50) await db.batch(batch.slice(i, i + 50))

  try {
    const { results } = await db
      .prepare(
        `SELECT endpoint, seat_id, p256dh, auth FROM push_subscriptions WHERE seat_id IN (${seatIds.map(() => '?').join(',')})`,
      )
      .bind(...seatIds)
      .all<{ endpoint: string; seat_id: string; p256dh: string; auth: string }>()
    if (results.length) {
      await pushChannel.send(
        results.map((r) => ({ endpoint: r.endpoint, seatId: r.seat_id, p256dh: r.p256dh, auth: r.auth })),
        n,
      )
    }
  } catch {
    // Push is best-effort; the in-app inbox is the source of truth.
  }
  return groupId
}

/**
 * Routes under /api/notifications:
 *   GET    /api/notifications                 → { rows, unread }   (?unread=1, ?limit=, ?offset=)
 *   POST   /api/notifications/read            { ids: [] }  or  { all: true }
 *   POST   /api/notifications/subscribe       { endpoint, keys: { p256dh, auth } }
 *   DELETE /api/notifications/subscribe       { endpoint }
 *
 * A seat can only ever see and mark its own rows - there is no cross-seat read.
 */
export async function handleNotifications(
  db: D1Database,
  parts: string[],
  method: string,
  url: URL,
  request: Request,
  me: Seat,
): Promise<Response | null> {
  const sub = parts[1]

  if (!sub && method === 'GET') {
    const { limit, offset } = paging(url, 50, 200)
    const unreadOnly = url.searchParams.get('unread') === '1'
    const clause = unreadOnly ? 'AND read_at IS NULL' : ''
    const { results } = await db
      .prepare(
        `SELECT * FROM notifications WHERE seat_id = ? ${clause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      )
      .bind(me.id, limit, offset)
      .all<{
        id: string; kind: string; title: string; body: string | null; link: string | null
        tbl: string | null; record_id: string | null; created_at: string; read_at: string | null
      }>()
    const unread = await db
      .prepare('SELECT COUNT(*) AS n FROM notifications WHERE seat_id = ? AND read_at IS NULL')
      .bind(me.id)
      .first<{ n: number }>()
    return json({
      unread: unread?.n ?? 0,
      rows: results.map((r) => ({
        id: r.id,
        kind: r.kind,
        title: r.title,
        body: r.body,
        link: r.link,
        tbl: r.tbl,
        recordId: r.record_id,
        createdAt: r.created_at,
        readAt: r.read_at,
      })),
    })
  }

  if (sub === 'read' && method === 'POST') {
    const body = (await request.json()) as { ids?: string[]; all?: boolean }
    if (body.all) {
      await db
        .prepare('UPDATE notifications SET read_at = ? WHERE seat_id = ? AND read_at IS NULL')
        .bind(now(), me.id)
        .run()
      return json({ ok: true })
    }
    const ids = (body.ids ?? []).filter((i) => typeof i === 'string')
    if (!ids.length) return json({ ok: true })
    await db
      .prepare(
        `UPDATE notifications SET read_at = ? WHERE seat_id = ? AND id IN (${ids.map(() => '?').join(',')})`,
      )
      .bind(now(), me.id, ...ids)
      .run()
    return json({ ok: true })
  }

  if (sub === 'subscribe' && method === 'POST') {
    const body = (await request.json()) as { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
    if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
      return json({ error: 'A push subscription needs an endpoint and both keys.' }, 400)
    }
    await db
      .prepare(
        'INSERT INTO push_subscriptions (endpoint, seat_id, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?) ' +
          'ON CONFLICT (endpoint) DO UPDATE SET seat_id = excluded.seat_id, p256dh = excluded.p256dh, auth = excluded.auth',
      )
      .bind(body.endpoint, me.id, body.keys.p256dh, body.keys.auth, now())
      .run()
    return json({ ok: true })
  }

  if (sub === 'subscribe' && method === 'DELETE') {
    const body = (await request.json().catch(() => ({}))) as { endpoint?: string }
    if (body.endpoint) {
      await db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND seat_id = ?').bind(body.endpoint, me.id).run()
    }
    return json({ ok: true })
  }

  return null
}
