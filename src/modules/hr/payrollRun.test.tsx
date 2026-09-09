// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { DEFAULT_HR_CONFIG } from '../../data/statutory'
import { ToastProvider } from '../../components/Toast'
import type { Payslip, PayrollRun } from '../../data/types'

const slip = (over: Partial<Payslip> = {}): Payslip => ({
  employeeId: 'p1',
  employeeName: 'J. Santos',
  role: 'driver',
  rateType: 'daily',
  baseRate: 800,
  days: {
    daysWorked: 10, daysAbsent: 0, paidLeaveDays: 0, unpaidLeaveDays: 0,
    regularOtHours: 2, restDayHours: 0, restDayOtHours: 0, specialDayHours: 0,
    specialDayOtHours: 0, regularHolidayHours: 0, regularHolidayOtHours: 0,
    nightDiffHours: 0, lateUndertimeMinutes: 0, unworkedRegularHolidays: 0,
  },
  earnings: {
    basicPay: 8000, overtimePay: 250, nightDiffPay: 0, restDayPay: 0, holidayPay: 0,
    allowance: 0, commission: 0, bonus: 0, bonusTaxable: true, incentive: 0,
    incentiveTaxable: true, otherEarnings: [],
  },
  deductions: {
    sss: 400, philhealth: 200, pagibig: 100, withholdingTax: 0,
    lateUndertime: 0, absences: 0, otherDeductions: [],
  },
  grossPay: 8250,
  taxableIncome: 7550,
  totalDeductions: 700,
  netPay: 7550,
  ...over,
})

/** Flipped by the finalized test - the mock reads it on every render. */
let status: PayrollRun['status'] = 'draft'

const run: PayrollRun = {
  id: 'r1', createdAt: '', updatedAt: '',
  periodStart: '2026-09-01', periodEnd: '2026-09-15',
  paySchedule: 'semi_monthly', status: 'draft',
  payslips: [slip(), slip({ employeeId: 'p2', employeeName: 'R. Cruz', baseRate: 0, netPay: 0, grossPay: 0 })],
}

const update = vi.fn(async () => ({}))
vi.mock('../../lib/data', () => ({
  useTables: () => ({
    personnel: [], shifts: [], holidays: [], attendance: [], leaves: [], sales: [],
    payrollRuns: [{ ...run, status }],
  }),
}))
vi.mock('../../lib/auth', () => ({ useAuth: () => ({ seat: { id: 's1', isAdmin: true } }) }))
vi.mock('../../lib/hrConfig', () => ({ useHrConfig: () => ({ config: DEFAULT_HR_CONFIG }) }))
vi.mock('../../data/repo', () => ({
  repos: { payrollRuns: { update: (...a: unknown[]) => update(...(a as [])), add: vi.fn(), remove: vi.fn() } },
}))

import PayrollTab from './PayrollTab'

afterEach(() => { cleanup(); update.mockClear(); status = 'draft' })

const openRun = () => {
  render(<ToastProvider><PayrollTab /></ToastProvider>)
  fireEvent.click(screen.getByRole('row', { name: /Sep 1, 2026/ }))
}

describe('Payroll run', () => {
  /** The editor used to open as an extra <tr> inside the table, so the totals it
   *  is about sat at the bottom of its own right-hand column. */
  it('opens a payslip as its own record, with the arithmetic in the rail', () => {
    openRun()
    fireEvent.click(screen.getByRole('row', { name: /J\. Santos/ }))
    const drawer = within(screen.getByRole('dialog'))
    expect(drawer.getByText('Earnings')).toBeTruthy()
    expect(drawer.getByText('Deductions')).toBeTruthy()
    expect(drawer.getByText('Net pay')).toBeTruthy()
    expect(drawer.getByLabelText('Basic pay')).toBeTruthy()
  })

  /** A finalized run is a snapshot. Every figure in it is read-only, and the
   *  buttons that would change it are not offered. */
  it('locks a finalized run', () => {
    status = 'finalized'
    openRun()
    expect(screen.queryByRole('button', { name: 'Finalize run' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete draft' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Reopen run' })).toBeTruthy()

    fireEvent.click(screen.getByRole('row', { name: /J\. Santos/ }))
    const drawer = within(screen.getByRole('dialog'))
    expect((drawer.getByLabelText('Basic pay') as HTMLInputElement).disabled).toBe(true)
    expect(drawer.queryByRole('button', { name: '+ Add earning' })).toBeNull()
  })

  /**
   * Finalizing was a browser confirm carrying the employee problems as
   * newline-separated text - unreadable, and impossible to check against the
   * table it was about.
   */
  it('lists what is wrong before finalizing, and still lets you through', () => {
    openRun()
    fireEvent.click(screen.getByRole('button', { name: 'Finalize run' }))
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.getByText('R. Cruz has no pay rate.')).toBeTruthy()
    expect(dialog.getByText('R. Cruz nets nothing.')).toBeTruthy()

    // Warned, not blocked.
    fireEvent.click(dialog.getByRole('button', { name: 'Finalize anyway' }))
    expect(update).toHaveBeenCalledWith('r1', { status: 'finalized' })
  })
})
