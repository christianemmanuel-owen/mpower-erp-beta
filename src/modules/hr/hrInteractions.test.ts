// @vitest-environment jsdom
// Regression tests for the two HR fixes:
//   1. Attendance "Mark all present" shows inline feedback (marked/skipped count).
//   2. Leaves left-panel balances rows are clickable and toggle the employee filter.
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest'
import React from 'react'
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { makeDemoData } from '../../data/seed'
import { DEFAULT_HR_CONFIG } from '../../data/statutory'

const seed: any = makeDemoData()

/**
 * Dates are derived from the seed, never from the wall clock.
 *
 * This used to read `new Date()`. The demo seed generates attendance for the ~55
 * days ending yesterday, so "today" was the first unencoded day and the test
 * quietly relied on that - plus on today being an ordinary working day. On
 * 21 August 2026 (Ninoy Aquino Day, in the seeded 2026 calendar) "Mark all
 * present" correctly marked nobody, and the test failed with "expected 0 to be
 * greater than 0" while pointing at HR code that was behaving exactly as
 * specified. A suite that fails on public holidays is worse than no suite: the
 * first instinct is to hunt for a bug in the wrong place.
 *
 * So both dates below are computed from the seed and the seeded holiday table,
 * and are correct whatever day the suite runs.
 */
const iso = (d: Date) => d.toISOString().slice(0, 10)
const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return iso(d)
}
const isSunday = (date: string) => new Date(`${date}T00:00:00.000Z`).getUTCDay() === 0
const holidayDates = new Set<string>(seed.holidays.map((h: any) => h.date))
/** Last day the seed encoded - everything up to here is already filled in. */
const lastEncoded: string = seed.attendance.map((a: any) => a.date).sort().pop()

/** First unencoded day matching `want`, so "already encoded" can never be the
 * reason a day marks nobody. */
function findDay(want: (date: string) => boolean): string {
  for (let i = 1; i <= 400; i++) {
    const date = addDays(lastEncoded, i)
    if (want(date)) return date
  }
  throw new Error('No matching day within a year of the seed - check the holiday table.')
}

/** An ordinary working day: unencoded, not a holiday, not a rest day. */
const WORKDAY = findDay((d) => !holidayDates.has(d) && !isSunday(d))
/** A holiday that isn't also a Sunday, so the skip is provably about the holiday. */
const HOLIDAY = findDay((d) => holidayDates.has(d) && !isSunday(d))

const today = WORKDAY

const addMock = vi.fn(async (r: any) => ({ id: 'new', ...r }))
const updateMock = vi.fn(async (_id: any, _c: any) => ({}))
const removeMock = vi.fn(async (_id: any) => {})

vi.mock('../../data/repo', () => ({
  repos: {
    attendance: {
      add: (r: any) => addMock(r),
      update: (id: any, c: any) => updateMock(id, c),
      remove: (id: any) => removeMock(id),
    },
    leaves: { remove: (id: any) => removeMock(id) },
  },
}))
vi.mock('../../lib/data', () => ({
  useTables: () => ({
    personnel: seed.personnel, shifts: seed.shifts, holidays: seed.holidays,
    attendance: seed.attendance, leaves: seed.leaves,
  }),
}))
vi.mock('../../lib/auth', () => ({ useAuth: () => ({ seat: { id: 's1' } }) }))
vi.mock('../../lib/hrConfig', () => ({ useHrConfig: () => ({ config: DEFAULT_HR_CONFIG }) }))
vi.mock('../../lib/range', () => ({
  useRange: () => ({ range: { from: today, to: today } }),
  RangePicker: () => null,
}))

import AttendanceTab from './AttendanceTab'
import { ToastProvider } from '../../components/Toast'
import LeavesTab from './LeavesTab'

// There is no global setup file, so nothing unmounts between tests by default -
// a second render would find two copies of every button.
afterEach(cleanup)

describe('Attendance: Mark all present', () => {
  beforeEach(() => { addMock.mockClear() })

  /**
   * The tab opens on the real today; every test here drives it to a known date.
   *
   * Wrapped in a ToastProvider because the result of Mark all present is a
   * notification now rather than a sentence appended to the card header - the
   * message is the same, and these tests still read it.
   */
  function renderOn(date: string) {
    const view = render(React.createElement(ToastProvider, null, React.createElement(AttendanceTab)))
    const input = view.container.querySelector('input[type="date"]') as HTMLInputElement
    expect(input).toBeTruthy()
    fireEvent.change(input, { target: { value: date } })
    return view
  }

  it('fills unencoded employees and shows a feedback message', async () => {
    renderOn(WORKDAY)
    fireEvent.click(screen.getByText('Mark all present'))
    await waitFor(() => expect(addMock.mock.calls.length).toBeGreaterThan(0))
    // Inline feedback appears with a count.
    await waitFor(() => expect(screen.getByText(/Marked \d+ present/)).toBeTruthy())
  })

  it('marks nobody present on a holiday, and says so', async () => {
    renderOn(HOLIDAY)
    fireEvent.click(screen.getByText('Mark all present'))
    // Nobody is scheduled, so the tab reports there was nothing to fill rather
    // than claiming it marked zero people.
    await waitFor(() => expect(screen.getByText(/Nothing to fill/)).toBeTruthy())
    expect(addMock.mock.calls.length).toBe(0)
  })
})

describe('Leaves: clickable balances panel', () => {
  it('toggles the employee filter when a balance row is clicked', () => {
    // Asserts the pressed state rather than the caption underneath the heading.
    // That caption is now a tip on the title, and a test keyed to its wording was
    // really testing the sentence, not the filter it was describing.
    render(React.createElement(LeavesTab))
    const row = screen.getAllByTitle(/Show only .* leaves/)[0]
    expect(row.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(row)
    const selected = screen.getByTitle('Click to clear filter')
    expect(selected.getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(selected)
    expect(screen.getAllByTitle(/Show only .* leaves/)[0].getAttribute('aria-pressed')).toBe('false')
  })
})
