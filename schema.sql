-- Cloudflare D1 schema for the MPower ERP.
-- Every business record lives in `records` as a JSON document keyed by (tbl, id) —
-- the client owns the shapes (see src/data/types.ts), the server just stores,
-- lists, and guards them. Seats (logins) are records too, under tbl='seats'.

CREATE TABLE IF NOT EXISTS records (
  tbl        TEXT NOT NULL,
  id         TEXT NOT NULL,
  data       TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tbl, id)
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  seat_id    TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Infrastructure tables (2026-08-20)
--
-- Business records stay JSON documents above: they are always read whole-table
-- and the client owns their shapes. The tables below are different — they are
-- queried by time, actor, target record and unread-state, so they get real
-- indexed columns instead. Everything here is IF NOT EXISTS, so re-running this
-- file against an existing database is safe.
-- ---------------------------------------------------------------------------

-- Uploaded digital copies (Exhibit A 1.2, 1.3, 1.4, 1.5, 1.9).
-- The bytes live in R2 under `key`; this row is the index and the metadata.
-- (tbl, record_id, slot) says which document of which record this is — e.g.
-- ('purchases', 'abc123', 'supplierPo') or ('customers', 'x9', 'bir2303').
CREATE TABLE IF NOT EXISTS attachments (
  id            TEXT PRIMARY KEY,
  tbl           TEXT NOT NULL,
  record_id     TEXT NOT NULL,
  slot          TEXT NOT NULL,
  r2_key        TEXT NOT NULL,
  filename      TEXT NOT NULL,
  content_type  TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  -- The document's own reference number, when it carries one (PO no., DR no.).
  reference_no  TEXT,
  uploaded_by   TEXT NOT NULL,
  uploaded_at   TEXT NOT NULL,
  -- Seam for Secondary Feature 2.14 (D). 'none' until an e-signature service is
  -- procured; nothing reads these columns yet.
  sign_status   TEXT NOT NULL DEFAULT 'none',
  sign_ref      TEXT,
  signed_r2_key TEXT
);
CREATE INDEX IF NOT EXISTS attachments_record ON attachments (tbl, record_id);
CREATE INDEX IF NOT EXISTS attachments_uploaded ON attachments (uploaded_at);

-- Staff input history (Secondary Feature 2.2). Every write through the API
-- lands here, including the before/after of changed fields.
CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         TEXT NOT NULL,
  seat_id    TEXT NOT NULL,
  seat_name  TEXT NOT NULL,
  -- create | update | delete | approve | reject | submit | upload | remove_file | login
  action     TEXT NOT NULL,
  tbl        TEXT NOT NULL,
  record_id  TEXT NOT NULL,
  summary    TEXT,
  -- JSON: { field: [before, after] }. Null for create/delete.
  changes    TEXT
);
CREATE INDEX IF NOT EXISTS audit_by_seat ON audit_log (seat_id, at DESC);
CREATE INDEX IF NOT EXISTS audit_by_record ON audit_log (tbl, record_id, at DESC);
CREATE INDEX IF NOT EXISTS audit_by_time ON audit_log (at DESC);

-- Approval-based inputs (Secondary Feature 2.1). A staff write to a table that
-- requires approval is parked here instead of being posted; an approver either
-- applies it (approve) or discards it (reject). `payload` is the proposed record
-- for a create, or the changes for an update.
CREATE TABLE IF NOT EXISTS approvals (
  id               TEXT PRIMARY KEY,
  tbl              TEXT NOT NULL,
  record_id        TEXT NOT NULL,
  action           TEXT NOT NULL,   -- create | update | delete
  status           TEXT NOT NULL,   -- pending | approved | rejected
  payload          TEXT NOT NULL,
  summary          TEXT,
  requested_by     TEXT NOT NULL,
  requested_by_name TEXT NOT NULL,
  requested_at     TEXT NOT NULL,
  decided_by       TEXT,
  decided_by_name  TEXT,
  decided_at       TEXT,
  decision_note    TEXT
);
CREATE INDEX IF NOT EXISTS approvals_pending ON approvals (status, requested_at DESC);
CREATE INDEX IF NOT EXISTS approvals_record ON approvals (tbl, record_id);

-- Notifications (Secondary Feature 2.11) — the shared channel 2.3, 2.4 and 2.9
-- deliver through. Broadcasts are fanned out to one row per recipient at emit
-- time (seat counts here are in the tens), so "my unread" is a single indexed
-- read; `group_id` ties a fan-out back together.
CREATE TABLE IF NOT EXISTS notifications (
  id         TEXT PRIMARY KEY,
  group_id   TEXT NOT NULL,
  seat_id    TEXT NOT NULL,
  -- low_stock | announcement | approval_request | approval_result | input_logged
  -- | collection_due | smart_lock | system
  kind       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  -- In-app route to open when the notification is clicked, e.g. '/inventory'.
  link       TEXT,
  tbl        TEXT,
  record_id  TEXT,
  created_at TEXT NOT NULL,
  read_at    TEXT
);
CREATE INDEX IF NOT EXISTS notifications_inbox ON notifications (seat_id, read_at, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_group ON notifications (group_id);

-- Web Push endpoints (Secondary Feature 2.11, browser delivery half).
-- Populated by the client's service worker; unused until VAPID keys are set.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint   TEXT PRIMARY KEY,
  seat_id    TEXT NOT NULL,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS push_by_seat ON push_subscriptions (seat_id);

-- Document reference-number series (Exhibit A 1.2, 1.3, 1.5, 1.6).
-- One row per (series, period): 'PO'/'2026' → next 41 yields "PO-2026-00041".
-- Allocation is a single UPDATE ... RETURNING, so two concurrent requests can
-- never take the same number.
CREATE TABLE IF NOT EXISTS counters (
  series  TEXT NOT NULL,
  period  TEXT NOT NULL,
  next    INTEGER NOT NULL,
  PRIMARY KEY (series, period)
);

-- Bootstrap login so a fresh database is never locked out: admin / admin.
-- passwordHash = SHA-256("bootstrap:admin"). Change the password after first login.
INSERT OR IGNORE INTO records (tbl, id, data, updated_at) VALUES (
  'seats',
  'seat-admin',
  '{"id":"seat-admin","createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z","name":"Admin","username":"admin","passwordHash":"c4b3790810a9e44b4ba4b24f4bffa402c39e770907b8018a31e6168d365b3c6e","salt":"bootstrap","role":"Owner","isAdmin":true,"modules":[]}',
  '2026-01-01T00:00:00.000Z'
);
