// Data exporting - Secondary Feature 2.12.
//
// "Export of System data to spreadsheet-readable files, for example .xlsx."
//
// A real .xlsx is a zip of XML parts. Writing one needs a zip encoder, which
// means a dependency - and the deflate work is pointless here because Excel,
// Numbers, LibreOffice and Google Sheets all open the stored (uncompressed) form
// perfectly well. So this writes the zip itself with stored entries and no
// dependency at all. The output is a genuine .xlsx, not a CSV with the wrong
// extension: multiple sheets, typed cells, and column widths all survive.

export type CellValue = string | number | boolean | null | undefined

export interface Sheet {
  name: string
  /** First row is the header. */
  headers: string[]
  rows: CellValue[][]
  /** Column widths in characters; defaults to something sensible per column. */
  widths?: number[]
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Excel forbids : \ / ? * [ ] in sheet names, and caps them at 31 characters. */
const safeSheetName = (n: string, i: number) =>
  (n.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || `Sheet${i + 1}`)

function colRef(index: number): string {
  let n = index + 1
  let ref = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    ref = String.fromCharCode(65 + rem) + ref
    n = Math.floor((n - 1) / 26)
  }
  return ref
}

function cellXml(value: CellValue, col: number, row: number, headerStyle: boolean): string {
  const ref = `${colRef(col)}${row}`
  const style = headerStyle ? ' s="1"' : ''
  if (value === null || value === undefined || value === '') return `<c r="${ref}"${style}/>`
  if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}"${style}><v>${value}</v></c>`
  if (typeof value === 'boolean') return `<c r="${ref}"${style} t="b"><v>${value ? 1 : 0}</v></c>`
  return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${esc(String(value))}</t></is></c>`
}

function sheetXml(sheet: Sheet): string {
  const widths = sheet.headers
    .map((h, i) => {
      const explicit = sheet.widths?.[i]
      if (explicit) return explicit
      const longest = Math.max(h.length, ...sheet.rows.map((r) => String(r[i] ?? '').length))
      return Math.min(Math.max(longest + 2, 9), 44)
    })
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join('')

  const header = `<row r="1">${sheet.headers.map((h, i) => cellXml(h, i, 1, true)).join('')}</row>`
  const body = sheet.rows
    .map((r, ri) => `<row r="${ri + 2}">${r.map((v, ci) => cellXml(v, ci, ri + 2, false)).join('')}</row>`)
    .join('')

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<cols>${widths}</cols>
<sheetData>${header}${body}</sheetData>
</worksheet>`
}

// ---- minimal zip writer (stored entries, no compression) --------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

interface ZipEntry { name: string; bytes: Uint8Array; crc: number; offset: number }

function zip(files: { name: string; content: string }[]): Blob {
  const encoder = new TextEncoder()
  const chunks: Uint8Array[] = []
  const entries: ZipEntry[] = []
  let offset = 0

  const push = (b: Uint8Array) => { chunks.push(b); offset += b.length }

  // DOS timestamp - a fixed valid value; the zip's own date isn't meaningful to
  // a spreadsheet reader and a stable one keeps output byte-identical to test.
  const dosTime = 0
  const dosDate = 0x2821 // 2000-01-01

  function header(name: Uint8Array, crc: number, size: number, central: boolean, entryOffset = 0) {
    const len = central ? 46 : 30
    const buf = new Uint8Array(len + name.length)
    const view = new DataView(buf.buffer)
    let p = 0
    view.setUint32(p, central ? 0x02014b50 : 0x04034b50, true); p += 4
    if (central) { view.setUint16(p, 20, true); p += 2 }   // version made by
    view.setUint16(p, 20, true); p += 2                     // version needed
    view.setUint16(p, 0, true); p += 2                      // flags
    view.setUint16(p, 0, true); p += 2                      // method: stored
    view.setUint16(p, dosTime, true); p += 2
    view.setUint16(p, dosDate, true); p += 2
    view.setUint32(p, crc, true); p += 4
    view.setUint32(p, size, true); p += 4                   // compressed
    view.setUint32(p, size, true); p += 4                   // uncompressed
    view.setUint16(p, name.length, true); p += 2
    view.setUint16(p, 0, true); p += 2                      // extra length
    if (central) {
      view.setUint16(p, 0, true); p += 2                    // comment length
      view.setUint16(p, 0, true); p += 2                    // disk number
      view.setUint16(p, 0, true); p += 2                    // internal attrs
      view.setUint32(p, 0, true); p += 4                    // external attrs
      view.setUint32(p, entryOffset, true); p += 4
    }
    buf.set(name, p)
    return buf
  }

  for (const file of files) {
    const name = encoder.encode(file.name)
    const bytes = encoder.encode(file.content)
    const crc = crc32(bytes)
    const entryOffset = offset
    push(header(name, crc, bytes.length, false))
    push(bytes)
    entries.push({ name: file.name, bytes, crc, offset: entryOffset })
  }

  const centralStart = offset
  for (const e of entries) {
    push(header(encoder.encode(e.name), e.crc, e.bytes.length, true, e.offset))
  }
  const centralSize = offset - centralStart

  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  endView.setUint32(0, 0x06054b50, true)
  endView.setUint16(8, entries.length, true)
  endView.setUint16(10, entries.length, true)
  endView.setUint32(12, centralSize, true)
  endView.setUint32(16, centralStart, true)
  push(end)

  return new Blob(chunks as BlobPart[], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

/** Builds the workbook as a Blob. Exported separately from the download so it
 * can be unit-tested and, later, attached to a record rather than saved. */
export function buildWorkbook(sheets: Sheet[]): Blob {
  const named = sheets.map((s, i) => ({ ...s, name: safeSheetName(s.name, i) }))

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${named.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('\n')}
</Types>`

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${named.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>
</workbook>`

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${named.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('\n')}
<Relationship Id="rId${named.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`

  // Two styles: 0 = default, 1 = bold (the header row).
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="1"><fill><patternFill patternType="none"/></fill></fills>
<borders count="1"><border/></borders>
<cellStyleXfs count="1"><xf/></cellStyleXfs>
<cellXfs count="2"><xf xfId="0"/><xf fontId="1" applyFont="1" xfId="0"/></cellXfs>
</styleSheet>`

  return zip([
    { name: '[Content_Types].xml', content: contentTypes },
    { name: '_rels/.rels', content: rootRels },
    { name: 'xl/workbook.xml', content: workbook },
    { name: 'xl/_rels/workbook.xml.rels', content: workbookRels },
    { name: 'xl/styles.xml', content: styles },
    ...named.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, content: sheetXml(s) })),
  ])
}

/** Builds and saves the workbook. `filename` gets .xlsx appended if missing. */
export function exportXlsx(filename: string, sheets: Sheet[]) {
  const blob = buildWorkbook(sheets)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}

/** Convenience for the common case: one table on screen, one sheet out. */
export function exportTable(filename: string, sheetName: string, headers: string[], rows: CellValue[][]) {
  exportXlsx(filename, [{ name: sheetName, headers, rows }])
}
