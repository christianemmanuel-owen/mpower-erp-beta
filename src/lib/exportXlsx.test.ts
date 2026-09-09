import { describe, expect, it } from 'vitest'
import { buildWorkbook } from './exportXlsx'

/** The zip is hand-written, so these tests check the bytes are a real archive -
 * a .xlsx that Excel refuses to open is worse than no export at all. */
async function bytes(blob: Blob) {
  return new Uint8Array(await blob.arrayBuffer())
}

const readU32 = (b: Uint8Array, at: number) => new DataView(b.buffer, b.byteOffset).getUint32(at, true)
const readU16 = (b: Uint8Array, at: number) => new DataView(b.buffer, b.byteOffset).getUint16(at, true)

/** Locates the end-of-central-directory record and reports what it claims. */
function endRecord(b: Uint8Array) {
  for (let i = b.length - 22; i >= 0; i--) {
    if (readU32(b, i) === 0x06054b50) {
      return {
        at: i,
        entries: readU16(b, i + 10),
        centralSize: readU32(b, i + 12),
        centralStart: readU32(b, i + 16),
      }
    }
  }
  throw new Error('no end-of-central-directory record')
}

/** Walks the central directory and returns each entry's stored name. */
function entryNames(b: Uint8Array) {
  const end = endRecord(b)
  const names: string[] = []
  let p = end.centralStart
  for (let i = 0; i < end.entries; i++) {
    expect(readU32(b, p)).toBe(0x02014b50)
    const nameLen = readU16(b, p + 28)
    const extraLen = readU16(b, p + 30)
    const commentLen = readU16(b, p + 32)
    names.push(new TextDecoder().decode(b.subarray(p + 46, p + 46 + nameLen)))
    p += 46 + nameLen + extraLen + commentLen
  }
  return names
}

/** Pulls one stored (uncompressed) entry's text back out via its local header. */
function readEntry(b: Uint8Array, want: string): string {
  let p = 0
  while (readU32(b, p) === 0x04034b50) {
    const size = readU32(b, p + 18)
    const nameLen = readU16(b, p + 26)
    const extraLen = readU16(b, p + 28)
    const name = new TextDecoder().decode(b.subarray(p + 30, p + 30 + nameLen))
    const dataAt = p + 30 + nameLen + extraLen
    if (name === want) return new TextDecoder().decode(b.subarray(dataAt, dataAt + size))
    p = dataAt + size
  }
  throw new Error(`entry ${want} not found`)
}

const sample = [
  {
    name: 'Sales',
    headers: ['Date', 'Customer', 'Volume (L)', 'Total'],
    rows: [
      ['2026-08-01', 'Alpha Trucking', 12000, 684000],
      ['2026-08-03', 'Bravo & Sons <Ltd>', 4500, 256500],
      ['2026-08-05', 'Charlie Fishing', null, 0],
    ],
  },
]

describe('exportXlsx', () => {
  it('writes a zip whose central directory matches its entries', async () => {
    const b = await bytes(buildWorkbook(sample))
    const end = endRecord(b)
    const names = entryNames(b)
    expect(names.length).toBe(end.entries)
    // The five package parts plus one sheet.
    expect(names).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/worksheets/sheet1.xml',
    ])
    expect(end.centralStart + end.centralSize).toBe(end.at)
  })

  it('starts with the local file header signature Excel looks for', async () => {
    const b = await bytes(buildWorkbook(sample))
    expect([b[0], b[1], b[2], b[3]]).toEqual([0x50, 0x4b, 0x03, 0x04])
  })

  it('writes numbers as numbers and text as inline strings', async () => {
    const b = await bytes(buildWorkbook(sample))
    const sheet = readEntry(b, 'xl/worksheets/sheet1.xml')
    // 12000 is a numeric cell, not a string.
    expect(sheet).toContain('<v>12000</v>')
    expect(sheet).toContain('t="inlineStr"')
    // Blank cells stay empty rather than becoming the text "null".
    expect(sheet).not.toContain('null')
  })

  it('escapes XML-hostile characters in cell text', async () => {
    const b = await bytes(buildWorkbook(sample))
    const sheet = readEntry(b, 'xl/worksheets/sheet1.xml')
    expect(sheet).toContain('Bravo &amp; Sons &lt;Ltd&gt;')
    expect(sheet).not.toContain('Bravo & Sons <Ltd>')
  })

  it('trims and sanitises sheet names Excel would reject', async () => {
    const b = await bytes(buildWorkbook([
      { name: 'Q3/Q4 collections: overdue accounts and everything else', headers: ['A'], rows: [['x']] },
    ]))
    const workbook = readEntry(b, 'xl/workbook.xml')
    const name = /name="([^"]+)"/.exec(workbook)?.[1] ?? ''
    expect(name.length).toBeLessThanOrEqual(31)
    expect(name).not.toMatch(/[\\/?*[\]:]/)
  })

  it('handles more than 26 columns without repeating a cell reference', async () => {
    const headers = Array.from({ length: 30 }, (_, i) => `H${i}`)
    const b = await bytes(buildWorkbook([{ name: 'Wide', headers, rows: [headers.map((_, i) => i)] }]))
    const sheet = readEntry(b, 'xl/worksheets/sheet1.xml')
    expect(sheet).toContain('r="Z1"')
    expect(sheet).toContain('r="AA1"')
    expect(sheet).toContain('r="AD1"')
  })
})
