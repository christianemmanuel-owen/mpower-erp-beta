import { describe, expect, it } from 'vitest'
import { todayISO } from '../../lib/format'
import { payrollDayShape } from '../../lib/payroll'
import { entryReportDate, rateByCollector } from '../../lib/collection'
import type { AttendanceRecord, Sale } from '../../data/types'

/**
 * Regression tests for the HR audit. Each one fails against the code as it was.
 */

describe('todayISO', () => {
  it('runs in the offset the business actually uses', () => {
    // Guards the guard: in UTC the next test passes even against the broken
    // spelling, so if this suite ever drifts back to UTC the regression below
    // stops being a regression test and nothing would say so.
    expect(new Date(2026, 2, 16, 6, 30).getTimezoneOffset()).toBe(-480)
  })

  it('reads the local calendar day, not the UTC one', () => {
    // 06:30 on 16 March, local. East of Greenwich this instant is still 15 March
    // in UTC, which is what the old `new Date().toISOString().slice(0,10)` returned -
    // so the attendance grid opened on yesterday for anyone encoding before 08:00.
    const early = new Date(2026, 2, 16, 6, 30)
    expect(todayISO(early)).toBe('2026-03-16')
  })

  it('holds on the last day of a month and on a leap day', () => {
    expect(todayISO(new Date(2026, 0, 31, 23, 59))).toBe('2026-01-31')
    expect(todayISO(new Date(2028, 1, 29, 0, 1))).toBe('2028-02-29')
  })

  it('zero-pads single-digit months and days', () => {
    expect(todayISO(new Date(2026, 8, 5, 12, 0))).toBe('2026-09-05')
  })
})

describe('payrollDayShape', () => {
  const rec = (over: Partial<AttendanceRecord>): AttendanceRecord => ({
    id: 'a', createdAt: '', updatedAt: '', employeeId: 'e', date: '2026-03-02',
    status: 'present', timeIn: '08:00', timeOut: '17:00', ...over,
  })

  it('counts a fully stamped present day as worked', () => {
    expect(payrollDayShape(rec({}))).toBe('present')
  })

  it('does NOT count a present day whose time out was never filled in', () => {
    // The attendance summary used to call this a day present while the payslip
    // called it a day absent - and deducted a day's pay from monthly staff.
    expect(payrollDayShape(rec({ timeOut: undefined }))).toBe('not-worked')
    expect(payrollDayShape(rec({ timeIn: undefined }))).toBe('not-worked')
  })

  it('treats a cleared stamp (null) the same as a missing one', () => {
    expect(payrollDayShape(rec({ timeOut: null }))).toBe('not-worked')
  })

  it('counts half days regardless of stamps, and absent never', () => {
    expect(payrollDayShape(rec({ status: 'half_day', timeOut: undefined }))).toBe('half')
    expect(payrollDayShape(rec({ status: 'absent' }))).toBe('not-worked')
    expect(payrollDayShape(undefined)).toBe('not-worked')
  })
})

describe('rateByCollector date scoping', () => {
  const sale = (id: string, collectorId: string, dueDate: string): Sale => ({
    id, createdAt: '', updatedAt: '', customerId: 'c', status: 'fulfilled',
    collectorId, items: [], installments: [
      { id: `${id}-i`, amount: 1000, dueDate, status: 'pending' },
    ],
  } as unknown as Sale)

  const sales = [sale('s1', 'p1', '2026-03-05'), sale('s2', 'p1', '2026-08-05')]

  it('covers every installment when no window is given', () => {
    const rows = rateByCollector(sales, Date.parse('2026-09-01'))
    expect(rows.find((r) => r.key === 'p1')?.rate.openOverdue).toBe(2)
  })

  it('counts only the installments inside the window when one is given', () => {
    // The KPI screen sat under a range picker while showing a lifetime figure:
    // moving the picker changed the quota column and left this one still.
    const rows = rateByCollector(
      sales,
      Date.parse('2026-09-01'),
      (e) => entryReportDate(e) >= '2026-07-01',
    )
    expect(rows.find((r) => r.key === 'p1')?.rate.openOverdue).toBe(1)
  })
})

describe('HR subpages are reachable', () => {
  // The bug this pins: KPI and Drug tests were rendered by the HR module and
  // documented as shipped, but appeared in no nav entry, so no click anywhere in
  // the app could open either. Rendering a screen is not the same as shipping it.
  it('lists every page the HR module can render', async () => {
    const { nav } = await import('../../lib/nav')
    const hr = nav.find((n) => n.to === '/hr')
    const links = (hr?.children ?? []).map((c) => c.to)

    for (const path of ['/hr', '/hr/leaves', '/hr/payroll', '/hr/employees',
      '/hr/performance', '/hr/drug-tests', '/hr/setup']) {
      expect(links).toContain(path)
    }
  })

  it('points employee, drug-test and payroll deep links at the screens that show them', async () => {
    const { recordHref } = await import('../../lib/deepLink')
    // All three used to resolve to '/hr', which opens the attendance grid.
    expect(recordHref('personnel', 'x')).toContain('/hr/employees')
    expect(recordHref('drugTests', 'x')).toContain('/hr/drug-tests')
    expect(recordHref('payrollRuns', 'x')).toContain('/hr/payroll')
  })
})
