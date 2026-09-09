/// <reference types="@cloudflare/workers-types" />
// Uploaded digital copies - Exhibit A 1.2, 1.3, 1.4, 1.5, 1.9.
//
// Fourteen Exhibit A line items say "reference number and uploaded digital copy
// of ..." or "upload, storage, and download of each document". They are all the
// same operation against different records, so they are one layer here rather
// than fourteen half-implementations.
//
// Bytes go to R2 under a content-addressed-ish key; the row in `attachments` is
// the index, the metadata, and the reference number. A document is identified by
// (tbl, recordId, slot) - e.g. ('purchases', 'abc', 'supplierPo').
//
// Downloads are proxied through this API rather than served from a public R2
// URL, so the seat guard applies to documents exactly as it applies to records.

import { err, json, newId, now, type Env, type Rec, type Seat } from './core'
import * as audit from './audit'

/** Documents the System stores, by owning table. The slot list is the contract
 * between the client's upload buttons and the server; anything not listed is
 * rejected, so a typo in a component can't quietly create a new document type. */
export const SLOTS: Record<string, readonly string[]> = {
  // 1.2 Inventory
  purchases: ['supplierPo', 'supplierDeliveryReceipt', 'fuelAnalysisSlip'],
  // 1.3 Sales, and 1.6 Collection - collections aren't records of their own
  // (an installment lives inside its sale), so their documents file against the
  // sale that owes the money.
  sales: ['clientPo', 'collectionForm', 'depositSlip', 'checkImage'],
  // 1.4 Accounts - account opening document checklist
  customers: ['bir2303', 'businessPermit', 'bankAccounts', 'customerProfileForm', 'other'],
  // 1.5 Logistics - documents by movement type
  deliveries: [
    'preDispatchChecklist',
    'deliveryReceipt',
    'clientLoadingSlip',
    'signedReceipt',
    'depotLoadingSlip',
    'supplierReceipt',
    'internalReceipt',
    'supplierDeliveryReceipt',
  ],
  // 1.7 HR
  personnel: ['drugTestResult', 'contract', 'govId'],
}

/** Account opening checklist (1.4) - the four documents an account needs before
 * it is fully opened. Exposed so the client can render the checklist without
 * hard-coding the list a second time. */
export const ACCOUNT_OPENING_SLOTS = ['bir2303', 'businessPermit', 'bankAccounts', 'customerProfileForm'] as const

const MAX_BYTES = 15 * 1024 * 1024

const ALLOWED_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])

export interface AttachmentRow {
  id: string
  tbl: string
  recordId: string
  slot: string
  filename: string
  contentType: string
  sizeBytes: number
  referenceNo: string | null
  uploadedBy: string
  uploadedAt: string
  /** Seam for 2.14 (D) - 'none' until an e-signature service is procured. */
  signStatus: string
  url: string
}

type DbRow = {
  id: string; tbl: string; record_id: string; slot: string; r2_key: string
  filename: string; content_type: string; size_bytes: number; reference_no: string | null
  uploaded_by: string; uploaded_at: string; sign_status: string
}

const toRow = (r: DbRow): AttachmentRow => ({
  id: r.id,
  tbl: r.tbl,
  recordId: r.record_id,
  slot: r.slot,
  filename: r.filename,
  contentType: r.content_type,
  sizeBytes: r.size_bytes,
  referenceNo: r.reference_no,
  uploadedBy: r.uploaded_by,
  uploadedAt: r.uploaded_at,
  signStatus: r.sign_status,
  url: `/api/attachments/${r.id}/file`,
})

/** Keeps filenames readable in R2 without letting a filename escape its prefix. */
function safeName(name: string) {
  return name.replace(/[^A-Za-z0-9._-]/g, '_').slice(-80) || 'file'
}

/** Everything filed against one record, newest first. */
export async function listFor(db: D1Database, tbl: string, recordId: string): Promise<AttachmentRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM attachments WHERE tbl = ? AND record_id = ? ORDER BY uploaded_at DESC')
    .bind(tbl, recordId)
    .all<DbRow>()
  return results.map(toRow)
}

/** Removes a record's documents from both R2 and the index - called when the
 * owning record is deleted, so blobs don't outlive what they belonged to. */
export async function removeFor(env: Env, tbl: string, recordId: string): Promise<void> {
  const { results } = await env.DB
    .prepare('SELECT r2_key, signed_r2_key FROM attachments WHERE tbl = ? AND record_id = ?')
    .bind(tbl, recordId)
    .all<{ r2_key: string; signed_r2_key: string | null }>()
  if (!results.length) return
  if (env.DOCS) {
    const keys = results.flatMap((r) => (r.signed_r2_key ? [r.r2_key, r.signed_r2_key] : [r.r2_key]))
    await env.DOCS.delete(keys).catch(() => {})
  }
  await env.DB.prepare('DELETE FROM attachments WHERE tbl = ? AND record_id = ?').bind(tbl, recordId).run()
}

/**
 * Routes under /api/attachments:
 *   GET    /api/attachments?tbl=&record=      → rows for one record
 *   POST   /api/attachments                   multipart: file, tbl, record, slot, referenceNo?
 *   GET    /api/attachments/:id/file          → the bytes (guarded, ?download=1 forces save)
 *   PUT    /api/attachments/:id               { referenceNo }
 *   DELETE /api/attachments/:id
 *
 * `canRead` / `canWrite` are passed in by the route so the same seat rules that
 * guard a record guard its documents - a seat without HR cannot read a payslip
 * attachment by knowing its id.
 */
export async function handleAttachments(
  env: Env,
  parts: string[],
  method: string,
  url: URL,
  request: Request,
  me: Seat,
  can: { read: (tbl: string) => boolean; write: (tbl: string) => boolean },
): Promise<Response | null> {
  const db = env.DB

  if (parts.length === 1 && method === 'GET') {
    const tbl = url.searchParams.get('tbl') ?? ''
    const recordId = url.searchParams.get('record') ?? ''
    if (!tbl || !recordId) return err(400, 'Which record’s documents? Pass tbl and record.')
    if (!can.read(tbl)) return err(403, 'You don’t have access to this record’s documents.')
    return json({ rows: await listFor(db, tbl, recordId) })
  }

  if (parts.length === 1 && method === 'POST') {
    if (!env.DOCS) return err(503, 'Document storage isn’t configured on this deployment yet.')
    const form = await request.formData()
    const file = form.get('file')
    const tbl = String(form.get('tbl') ?? '')
    const recordId = String(form.get('record') ?? '')
    const slot = String(form.get('slot') ?? '')
    const referenceNo = form.get('referenceNo') ? String(form.get('referenceNo')) : null

    if (!(file instanceof File)) return err(400, 'No file was uploaded.')
    if (!SLOTS[tbl]) return err(400, `Documents can’t be filed against ${tbl}.`)
    if (!SLOTS[tbl].includes(slot)) return err(400, `"${slot}" isn’t a document type for ${tbl}.`)
    if (!can.write(tbl)) return err(403, 'You don’t have access to add documents to this record.')
    if (file.size === 0) return err(400, 'That file is empty.')
    if (file.size > MAX_BYTES) return err(413, `Files must be under ${MAX_BYTES / 1024 / 1024} MB.`)
    const contentType = file.type || 'application/octet-stream'
    if (!ALLOWED_TYPES.has(contentType)) {
      return err(415, 'Upload a PDF, a photo, or an Office document.')
    }
    const owner = await db.prepare('SELECT id FROM records WHERE tbl = ? AND id = ?').bind(tbl, recordId).first()
    if (!owner) return err(404, 'That record doesn’t exist.')

    const id = newId()
    const key = `${tbl}/${recordId}/${slot}/${id}-${safeName(file.name)}`
    await env.DOCS.put(key, file.stream(), { httpMetadata: { contentType } })
    await db
      .prepare(
        'INSERT INTO attachments (id, tbl, record_id, slot, r2_key, filename, content_type, size_bytes, reference_no, uploaded_by, uploaded_at) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(id, tbl, recordId, slot, key, file.name, contentType, file.size, referenceNo, me.id, now())
      .run()
    await audit.record(db, {
      seat: me, action: 'upload', tbl, recordId,
      summary: `uploaded ${file.name} as ${slot}`,
    })

    const row = await db.prepare('SELECT * FROM attachments WHERE id = ?').bind(id).first<DbRow>()
    return json(toRow(row as DbRow), 201)
  }

  const id = parts[1]
  if (!id) return null
  const rec = await db.prepare('SELECT * FROM attachments WHERE id = ?').bind(id).first<DbRow>()
  if (!rec) return err(404, 'That document isn’t here.')

  if (parts[2] === 'file' && method === 'GET') {
    if (!can.read(rec.tbl)) return err(403, 'You don’t have access to this document.')
    if (!env.DOCS) return err(503, 'Document storage isn’t configured on this deployment yet.')
    const object = await env.DOCS.get(rec.r2_key)
    if (!object) return err(404, 'The stored file is missing.')
    const disposition = url.searchParams.get('download') === '1' ? 'attachment' : 'inline'
    return new Response(object.body, {
      headers: {
        'content-type': rec.content_type,
        'content-length': String(rec.size_bytes),
        'content-disposition': `${disposition}; filename="${safeName(rec.filename)}"`,
        'cache-control': 'private, max-age=300',
      },
    })
  }

  if (parts.length === 2 && method === 'PUT') {
    if (!can.write(rec.tbl)) return err(403, 'You don’t have access to this document.')
    const body = (await request.json()) as { referenceNo?: string }
    await db
      .prepare('UPDATE attachments SET reference_no = ? WHERE id = ?')
      .bind(body.referenceNo ?? null, id)
      .run()
    await audit.record(db, {
      seat: me, action: 'update', tbl: rec.tbl, recordId: rec.record_id,
      summary: `set the reference number on ${rec.filename}`,
    })
    const updated = await db.prepare('SELECT * FROM attachments WHERE id = ?').bind(id).first<DbRow>()
    return json(toRow(updated as DbRow))
  }

  if (parts.length === 2 && method === 'DELETE') {
    if (!can.write(rec.tbl)) return err(403, 'You don’t have access to this document.')
    if (env.DOCS) await env.DOCS.delete(rec.r2_key).catch(() => {})
    await db.prepare('DELETE FROM attachments WHERE id = ?').bind(id).run()
    await audit.record(db, {
      seat: me, action: 'remove_file', tbl: rec.tbl, recordId: rec.record_id,
      summary: `removed ${rec.filename}`,
    })
    return json({ ok: true })
  }

  return null
}

/** Exported for the route's OPTIONS/discovery response and the client's
 * checklist UI, so the slot vocabulary has exactly one definition. */
export function slotCatalogue(): Rec {
  return { slots: SLOTS, accountOpening: ACCOUNT_OPENING_SLOTS, maxBytes: MAX_BYTES }
}
