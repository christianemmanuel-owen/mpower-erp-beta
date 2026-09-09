// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { DEFAULT_HR_CONFIG } from '../../data/statutory'
import { ToastProvider } from '../../components/Toast'

// A Monday to a Wednesday, so every day in the range is an ordinary workday.
const FROM = '2026-09-07'
const TO = '2026-09-09'

const shift = {
  id: 'sh1', createdAt: '', updatedAt: '', name: 'Day shift',
  startTime: '07:00', endTime: '16:00', breakMinutes: 60, restDays: [0],
}
const personnel = [{
  id: 'p1', createdAt: '', updatedAt: '', name: 'J. Santos', role: 'driver',
  active: true, shiftId: 'sh1', contactNumber: '', address: '',
}]
const attendance = [
  { id: 'a1', createdAt: '', updatedAt: '', employeeId: 'p1', date: FROM, status: 'present', timeIn: '07:00', timeOut: '16:00' },
  // Encoded present, no time out: payroll pays this day as nothing.
  { id: 'a2', createdAt: '', updatedAt: '', employeeId: 'p1', date: '2026-09-08', status: 'present', timeIn: '07:00', timeOut: null },
  // Nothing at all on the 9th - the row that only a day-by-day list can show.
]

vi.mock('../../lib/data', () => ({
  useTables: () => ({ personnel, shifts: [shift], holidays: [], attendance, leaves: [] }),
}))
vi.mock('../../lib/auth', () => ({ useAuth: () => ({ seat: { id: 's1' } }) }))
vi.mock('../../lib/hrConfig', () => ({ useHrConfig: () => ({ config: DEFAULT_HR_CONFIG }) }))
vi.mock('../../lib/range', () => ({
  useRange: () => ({ range: { from: FROM, to: TO } }),
  RangePicker: () => <span>range picker</span>,
}))
vi.mock('../../data/repo', () => ({ repos: { attendance: { add: vi.fn(), update: vi.fn(), remove: vi.fn() } } }))

import AttendanceTab from './AttendanceTab'

afterEach(cleanup)

const view = () => render(<ToastProvider><AttendanceTab /></ToastProvider>)

describe('Attendance views', () => {
  /** They used to be two cards stacked, so reaching the totals payroll reads
   *  meant scrolling past every employee's day. */
  it('shows one view at a time, with the control that governs it', () => {
    view()
    expect(screen.getByLabelText('Date')).toBeTruthy()
    expect(screen.queryByText('range picker')).toBeNull()
    // The day's grid, not the period's: they share no column.
    expect(screen.getByRole('columnheader', { name: 'Time in' })).toBeTruthy()
    expect(screen.queryByRole('columnheader', { name: 'Days present' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Period summary' }))
    expect(screen.getByRole('columnheader', { name: 'Days present' })).toBeTruthy()
    expect(screen.queryByRole('columnheader', { name: 'Time in' })).toBeNull()
    // The range picker replaces the date: one control, and it is the one that
    // scopes what is on screen.
    expect(screen.getByText('range picker')).toBeTruthy()
    expect(screen.queryByLabelText('Date')).toBeNull()
  })

  /**
   * The view that was missing: one day for everyone existed, a period total per
   * person existed, one person's period in detail did not.
   */
  it('opens an employee day by day, including the days with nothing on them', () => {
    view()
    fireEvent.click(screen.getByRole('button', { name: /J\. Santos/ }))
    const drawer = within(screen.getByRole('dialog'))

    expect(drawer.getByText('Sep 7')).toBeTruthy()
    expect(drawer.getByText('Nothing encoded')).toBeTruthy()
    expect(drawer.getByText('no time out')).toBeTruthy()
    // One workday in the range has no record at all, and the rail says so.
    expect(drawer.getByText('Workdays not encoded')).toBeTruthy()
  })

  it('jumps from a day in the drawer to that day in the grid', () => {
    view()
    fireEvent.click(screen.getByRole('button', { name: /J\. Santos/ }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Sep 9/ }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect((screen.getByLabelText('Date') as HTMLInputElement).value).toBe('2026-09-09')
  })

  it('counts the period the same way in the table and in the drawer', () => {
    view()
    fireEvent.click(screen.getByRole('button', { name: 'Period summary' }))
    const row = screen.getByRole('row', { name: /J\. Santos/ })
    // One clean day present, one encoded with no time out - the second is not
    // counted as present, and not as absent either.
    const cells = within(row).getAllByRole('cell')
    expect(cells[1].textContent).toBe('1')
    expect(cells[2].textContent).toBe('—')
    expect(cells[3].textContent).toBe('1')

    fireEvent.click(row)
    const drawer = within(screen.getByRole('dialog'))
    // The rail states the same two facts the row does: one day present, one day
    // payroll will not pay. "No time out" appears twice - once as the rail row,
    // once as the chip on the day itself.
    expect(drawer.getByText('Days present')).toBeTruthy()
    expect(drawer.getAllByText('No time out').length).toBe(2)
  })
})
