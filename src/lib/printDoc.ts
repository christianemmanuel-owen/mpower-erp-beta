// Printable outputs - Exhibit A 1.9 and Secondary Feature 2.6.
//
// "Each form, slip, receipt, and checklist specified in Sections 1.1 to 1.8 is
// generated from its System record as a printable and downloadable PDF."
//
// Approach: render each document as a self-contained HTML page on a fixed paper
// size and hand it to the browser's own print-to-PDF. No PDF library, no server
// round-trip, and the output is a real vector PDF with selectable text - which
// matters because these documents get signed, filed, and later scanned back in
// as attachments.
//
// The seven templates Secondary Feature 2.6 names are built on `renderDocument`
// below (see src/lib/templates.ts). Anything not on that list is a Change
// Request under §6 of the Agreement.

import { todayISO } from './format'

export type PaperSize = 'A4' | 'Letter'

export interface DocumentMeta {
  /** Printed in the header, e.g. "Delivery Receipt". */
  title: string
  /** The document's own reference number, e.g. "DR-2026-00041". */
  referenceNo?: string
  /** ISO date shown top-right. Defaults to today. */
  date?: string
  paper?: PaperSize
}

export interface Cell {
  label: string
  value: string
}

/** A block of label/value pairs - the shape most of these documents are. */
export interface FieldBlock {
  kind: 'fields'
  heading?: string
  /** 1 puts each field on its own row; 2 is the usual two-column form. */
  columns?: 1 | 2
  cells: Cell[]
}

/** A line-items table. */
export interface TableBlock {
  kind: 'table'
  heading?: string
  headers: string[]
  rows: string[][]
  /** Columns to right-align, by index - amounts and volumes. */
  numericColumns?: number[]
  /** Rendered bold under the table, e.g. a total. */
  footer?: string[]
}

/** Tick-boxes for a checklist (Exhibit A 1.5 pre-dispatch checklist). Printed
 * ticked or unticked to match what was recorded; an unrecorded item prints as an
 * empty box so it can be completed by hand. */
export interface ChecklistBlock {
  kind: 'checklist'
  heading?: string
  items: { label: string; checked?: boolean }[]
  columns?: 1 | 2
}

/** Signature lines. Exhibit A 1.5 requires several documents to be signed by
 * loading personnel, guard on duty, and manager, and by the counterparty. */
export interface SignatureBlock {
  kind: 'signatures'
  heading?: string
  /** `image` is a drawn signature (PNG data URL); with one, the line is drawn under it. */
  signatories: { role: string; name?: string; image?: string; signedAt?: string }[]
}

export interface NoteBlock {
  kind: 'note'
  text: string
}

export type Block = FieldBlock | TableBlock | ChecklistBlock | SignatureBlock | NoteBlock

export interface CompanyHeader {
  name: string
  address?: string
  contact?: string
  tin?: string
}

const DEFAULT_COMPANY: CompanyHeader = { name: 'MPower Diesel Trading' }

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function fieldsHtml(b: FieldBlock) {
  const cols = b.columns ?? 2
  const cells = b.cells
    .map(
      (c) => `<div class="cell"><span class="lab">${esc(c.label)}</span><span class="val">${esc(c.value || '—')}</span></div>`,
    )
    .join('')
  return `${b.heading ? `<h2>${esc(b.heading)}</h2>` : ''}<div class="fields c${cols}">${cells}</div>`
}

function tableHtml(b: TableBlock) {
  const num = new Set(b.numericColumns ?? [])
  const head = b.headers.map((h, i) => `<th class="${num.has(i) ? 'r' : ''}">${esc(h)}</th>`).join('')
  const body = b.rows
    .map((r) => `<tr>${r.map((c, i) => `<td class="${num.has(i) ? 'r' : ''}">${esc(c)}</td>`).join('')}</tr>`)
    .join('')
  const foot = b.footer
    ? `<tfoot><tr>${b.footer.map((c, i) => `<td class="${num.has(i) ? 'r' : ''}"><b>${esc(c)}</b></td>`).join('')}</tr></tfoot>`
    : ''
  return `${b.heading ? `<h2>${esc(b.heading)}</h2>` : ''}<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${foot}</table>`
}

function checklistHtml(b: ChecklistBlock) {
  const items = b.items
    .map((i) => `<div class="check"><span class="box">${i.checked ? '&#10003;' : ''}</span>${esc(i.label)}</div>`)
    .join('')
  return `${b.heading ? `<h2>${esc(b.heading)}</h2>` : ''}<div class="checks c${b.columns ?? 2}">${items}</div>`
}

function signaturesHtml(b: SignatureBlock) {
  const sigs = b.signatories
    .map(
      (s) =>
        `<div class="sig">${s.image ? `<img class="ink" src="${s.image}" alt="">` : ''}<div class="line"></div><div class="who">${esc(s.name ?? '')}${s.signedAt ? `<span class="when"> · signed ${esc(s.signedAt.slice(0, 10))}</span>` : ''}</div><div class="role">${esc(s.role)}</div></div>`,
    )
    .join('')
  return `${b.heading ? `<h2>${esc(b.heading)}</h2>` : ''}<div class="sigs">${sigs}</div>`
}

function blockHtml(b: Block): string {
  switch (b.kind) {
    case 'fields': return fieldsHtml(b)
    case 'table': return tableHtml(b)
    case 'checklist': return checklistHtml(b)
    case 'signatures': return signaturesHtml(b)
    case 'note': return `<p class="note">${esc(b.text)}</p>`
  }
}

/** The whole print stylesheet. Kept inline so the document is one self-contained
 * file - it has to survive being saved, emailed, and printed elsewhere. */
function styles(paper: PaperSize) {
  return `
    @page { size: ${paper}; margin: 14mm 14mm 16mm; }
    * { box-sizing: border-box; }
    body { margin: 0; font: 11px/1.45 "IBM Plex Sans", system-ui, -apple-system, sans-serif; color: #16202e; }
    header { display: flex; justify-content: space-between; align-items: flex-start;
             border-bottom: 2px solid #16202e; padding-bottom: 8px; margin-bottom: 14px; }
    .co { font-size: 15px; font-weight: 700; letter-spacing: -.01em; }
    .co-sub { font-size: 10px; color: #5a6779; margin-top: 2px; }
    .doc { text-align: right; }
    .doc-title { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; }
    .doc-meta { font-size: 10px; color: #5a6779; margin-top: 3px; }
    .doc-ref { font-size: 12px; font-weight: 700; margin-top: 2px; }
    h2 { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .07em;
         color: #5a6779; margin: 16px 0 6px; }
    .fields { display: grid; gap: 6px 18px; }
    .fields.c1 { grid-template-columns: 1fr; }
    .fields.c2 { grid-template-columns: 1fr 1fr; }
    .cell { display: flex; gap: 6px; border-bottom: 1px dotted #c9d1dc; padding-bottom: 3px; }
    .lab { color: #5a6779; min-width: 34%; }
    .val { font-weight: 600; }
    table { width: 100%; border-collapse: collapse; margin-top: 4px; }
    th, td { border-bottom: 1px solid #dfe4ec; padding: 5px 6px; text-align: left; }
    th { font-size: 9px; text-transform: uppercase; letter-spacing: .05em; color: #5a6779;
         border-bottom: 1.5px solid #16202e; }
    td.r, th.r { text-align: right; }
    tfoot td { border-top: 1.5px solid #16202e; border-bottom: none; }
    .checks { display: grid; gap: 5px 18px; }
    .checks.c1 { grid-template-columns: 1fr; }
    .checks.c2 { grid-template-columns: 1fr 1fr; }
    .check { display: flex; align-items: center; gap: 7px; }
    .box { display: inline-flex; align-items: center; justify-content: center;
           width: 13px; height: 13px; border: 1.2px solid #16202e; font-size: 10px; flex: none; }
    .sigs { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 22px 18px; margin-top: 26px; }
    .sig .line { border-bottom: 1px solid #16202e; height: 26px; }
    .sig .ink { display: block; height: 34px; width: auto; max-width: 100%; margin-bottom: -30px; position: relative; }
    .sig .when { font-weight: 400; color: #5a6779; }
    .sig .who { font-size: 10px; font-weight: 600; margin-top: 3px; min-height: 13px; }
    .sig .role { font-size: 9px; color: #5a6779; text-transform: uppercase; letter-spacing: .05em; }
    .note { font-size: 10px; color: #5a6779; margin-top: 12px; }
    footer { position: fixed; bottom: 6mm; left: 14mm; right: 14mm;
             font-size: 8.5px; color: #8b96a6; border-top: 1px solid #dfe4ec; padding-top: 4px;
             display: flex; justify-content: space-between; }
    @media screen { body { background: #eef1f5; padding: 20px; }
      .page { background: #fff; max-width: 210mm; margin: 0 auto; padding: 16mm; box-shadow: 0 2px 12px rgba(0,0,0,.12); }
      footer { position: static; margin-top: 20px; } }
  `
}

/** Builds the complete HTML document. Exported so it can be unit-tested and, in
 * future, handed to a server-side renderer without changing any caller. */
export function renderDocument(meta: DocumentMeta, blocks: Block[], company: CompanyHeader = DEFAULT_COMPANY): string {
  const date = meta.date ?? todayISO()
  const printed = new Date().toLocaleString('en-PH')
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${esc(meta.title)}${meta.referenceNo ? ` ${esc(meta.referenceNo)}` : ''}</title>
<style>${styles(meta.paper ?? 'A4')}</style></head>
<body><div class="page">
<header>
  <div>
    <div class="co">${esc(company.name)}</div>
    ${company.address ? `<div class="co-sub">${esc(company.address)}</div>` : ''}
    ${company.contact ? `<div class="co-sub">${esc(company.contact)}</div>` : ''}
    ${company.tin ? `<div class="co-sub">TIN ${esc(company.tin)}</div>` : ''}
  </div>
  <div class="doc">
    <div class="doc-title">${esc(meta.title)}</div>
    ${meta.referenceNo ? `<div class="doc-ref">${esc(meta.referenceNo)}</div>` : ''}
    <div class="doc-meta">${esc(date)}</div>
  </div>
</header>
${blocks.map(blockHtml).join('\n')}
<footer><span>${esc(company.name)} - ${esc(meta.title)}</span><span>Printed ${esc(printed)}</span></footer>
</div></body></html>`
}

/**
 * Opens the document in a print window. The user's "Save as PDF" produces the
 * downloadable PDF Exhibit A 1.9 asks for.
 *
 * Returns false if the browser blocked the popup, so the caller can tell the
 * user rather than appearing to do nothing.
 */
export function printDocument(meta: DocumentMeta, blocks: Block[], company?: CompanyHeader): boolean {
  const html = renderDocument(meta, blocks, company)
  const win = window.open('', '_blank', 'width=880,height=1000')
  if (!win) return false
  win.document.write(html)
  win.document.close()
  // Let fonts and layout settle before the print dialog, or the first page can
  // render mid-reflow.
  win.setTimeout(() => win.print(), 350)
  return true
}

/** Saves the document as a standalone .html file - the path for a user who wants
 * the file itself rather than a print dialog, and the form exported to a
 * Client-nominated shared storage location (Exhibit A 1.9). */
export function downloadDocument(meta: DocumentMeta, blocks: Block[], company?: CompanyHeader) {
  const html = renderDocument(meta, blocks, company)
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${meta.referenceNo ?? meta.title.replace(/\s+/g, '-').toLowerCase()}.html`
  a.click()
  URL.revokeObjectURL(url)
}
