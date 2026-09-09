import { describe, expect, it } from 'vitest'
import { RECORD_PARAM, recordHref } from './deepLink'

/**
 * A broken deep link fails silently - the user lands on a list and assumes they
 * mis-clicked. Worth pinning the URL shape and, more importantly, the tables
 * that have no screen to open.
 */
describe('recordHref', () => {
  it('points each table at the module that owns it', () => {
    expect(recordHref('sales', 'abc')).toBe(`/sales?${RECORD_PARAM}=abc`)
    expect(recordHref('purchases', 'abc')).toBe(`/inventory?${RECORD_PARAM}=abc`)
    expect(recordHref('deliveries', 'abc')).toBe(`/logistics?${RECORD_PARAM}=abc`)
    expect(recordHref('customers', 'abc')).toBe(`/accounts?${RECORD_PARAM}=abc`)
  })

  it('returns null for a table with no screen, so callers render plain text', () => {
    // Rendering a link that goes nowhere is worse than rendering no link.
    expect(recordHref('attachments', 'abc')).toBeNull()
    expect(recordHref('hrSettings', 'abc')).toBeNull()
  })

  it('escapes an id that would otherwise break the query string', () => {
    expect(recordHref('sales', 'a b&c=d')).toBe(`/sales?${RECORD_PARAM}=a%20b%26c%3Dd`)
  })

  it('round-trips through URLSearchParams', () => {
    const id = 'x/y?z&w'
    const href = recordHref('sales', id) as string
    const parsed = new URLSearchParams(href.slice(href.indexOf('?')))
    expect(parsed.get(RECORD_PARAM)).toBe(id)
  })
})
