import { describe, expect, it } from 'vitest'
import { renderDocument, type Block } from './printDoc'

/** The templates render user-entered text (customer names, notes, reasons)
 * straight into HTML, so escaping is the thing that must not break. */
describe('renderDocument', () => {
  const meta = { title: 'Delivery Receipt', referenceNo: 'DR-2026-00041', date: '2026-08-20' }

  it('puts the title and reference number in the document', () => {
    const html = renderDocument(meta, [])
    expect(html).toContain('Delivery Receipt')
    expect(html).toContain('DR-2026-00041')
    expect(html).toContain('<!doctype html>')
  })

  it('escapes text coming from records', () => {
    const blocks: Block[] = [
      { kind: 'fields', cells: [{ label: 'Customer', value: 'Bravo & Sons <script>alert(1)</script>' }] },
    ]
    const html = renderDocument(meta, blocks)
    expect(html).not.toContain('<script>')
    expect(html).toContain('Bravo &amp; Sons &lt;script&gt;')
  })

  it('renders a blank value as an em dash rather than "undefined"', () => {
    const html = renderDocument(meta, [{ kind: 'fields', cells: [{ label: 'Notes', value: '' }] }])
    expect(html).toContain('—')
    expect(html).not.toContain('undefined')
  })

  it('ticks only the checklist items that were recorded as done', () => {
    const html = renderDocument(meta, [
      {
        kind: 'checklist',
        items: [
          { label: 'Full tank confirmed', checked: true },
          { label: 'Body cam present', checked: false },
          { label: 'Tires inspected' },
        ],
      },
    ])
    // One tick for the single checked item; the rest print as empty boxes to be
    // completed by hand.
    expect(html.match(/&#10003;/g)?.length).toBe(1)
    expect(html.match(/class="box"/g)?.length).toBe(3)
  })

  it('right-aligns the columns a template marks numeric', () => {
    const html = renderDocument(meta, [
      { kind: 'table', headers: ['Item', 'Volume'], rows: [['Diesel', '12,000 L']], numericColumns: [1] },
    ])
    expect(html).toContain('<th class="r">Volume</th>')
    expect(html).toContain('<td class="r">12,000 L</td>')
  })
})
