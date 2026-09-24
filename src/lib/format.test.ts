import { describe, expect, it } from 'vitest'
import { addDaysISO, fmtTerm, fmtCurrencyShort } from './format'

describe('addDaysISO', () => {
  it('adds days within a month', () => {
    expect(addDaysISO('2026-07-15', 10)).toBe('2026-07-25')
  })

  it('rolls over a month boundary', () => {
    expect(addDaysISO('2026-07-15', 30)).toBe('2026-08-14')
  })

  it('rolls over a year boundary', () => {
    expect(addDaysISO('2026-12-25', 10)).toBe('2027-01-04')
  })

  it('handles end-of-month overflow (Jan 31 + 1 day)', () => {
    expect(addDaysISO('2026-01-31', 1)).toBe('2026-02-01')
  })

  it('is a no-op for 0 days', () => {
    expect(addDaysISO('2026-07-15', 0)).toBe('2026-07-15')
  })

  it('tolerates a full ISO datetime string as input', () => {
    expect(addDaysISO('2026-07-15T08:30:00.000Z', 5)).toBe('2026-07-20')
  })
})

describe('fmtTerm', () => {
  it('labels a positive term as Net N', () => {
    expect(fmtTerm(30)).toBe('Net 30')
    expect(fmtTerm(15)).toBe('Net 15')
  })

  it('labels zero or negative terms as COD', () => {
    expect(fmtTerm(0)).toBe('COD')
    expect(fmtTerm(-5)).toBe('COD')
  })
})

describe('fmtCurrencyShort', () => {
  it('abbreviates so a summary cell never wraps', () => {
    expect(fmtCurrencyShort(1_184_000)).toBe('₱1.18M')
    expect(fmtCurrencyShort(312_000)).toBe('₱312k')
    expect(fmtCurrencyShort(9_500)).toBe('₱9,500')
    expect(fmtCurrencyShort(0)).toBe('₱0')
  })
})
