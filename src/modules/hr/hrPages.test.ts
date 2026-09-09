// @vitest-environment jsdom
/**
 * Smoke render of every HR subpage.
 *
 * tsc and the build cannot tell you that a page mounts - HR shipped two screens
 * that compiled, built and were documented as done while being unreachable and,
 * as far as anyone could demonstrate, unrendered. This walks each page the module
 * can show and asserts it puts something on screen.
 */
import { ToastProvider } from '../../components/Toast'
import { afterEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { makeDemoData } from '../../data/seed'
import { DEFAULT_HR_CONFIG } from '../../data/statutory'
import type { HrPage } from './Hr'

const seed: any = makeDemoData()

vi.mock('../../data/repo', () => ({
  repos: new Proxy({}, {
    get: () => ({ add: async () => ({}), update: async () => ({}), remove: async () => {} }),
  }),
}))
vi.mock('../../lib/data', () => ({
  useTables: () => ({
    personnel: seed.personnel, shifts: seed.shifts, holidays: seed.holidays,
    attendance: seed.attendance, leaves: seed.leaves, payrollRuns: seed.payrollRuns ?? [],
    sales: seed.sales, agents: seed.agents, drugTests: seed.drugTests ?? [],
    customers: seed.customers, suppliers: seed.suppliers,
  }),
}))
vi.mock('../../lib/auth', () => ({ useAuth: () => ({ seat: { id: 's1', isAdmin: true } }) }))
vi.mock('../../lib/hrConfig', () => ({
  useHrConfig: () => ({ config: DEFAULT_HR_CONFIG, record: { id: 'c1' } }),
}))
vi.mock('../../lib/range', () => ({
  useRange: () => ({ range: { from: '2026-01-01', to: '2026-12-31' } }),
  RangePicker: () => null,
}))

import Hr from './Hr'

afterEach(cleanup)

/**
 * Each page is paired with text only that page's own body renders. Asserting
 * merely that something rendered would pass on the page title alone, which the
 * shell prints for every page - the test would hold even if the subpage below it
 * drew nothing at all.
 */
const PAGES: [HrPage, RegExp][] = [
  ['attendance', /Daily time record/],
  ['leaves', /Leave records/],
  ['payroll', /Payroll runs/],
  ['employees', /Employees/],
  // The screen leads with the team's figures now; "Per employee" was the
  // heading of the card grid this replaced.
  ['kpi', /Team quota attainment/],
  ['drugTests', /tested/],
  ['setup', /Workday hours|Shifts|Premium/],
]

describe('every HR subpage mounts', () => {
  for (const [page, marker] of PAGES) {
    it(`renders the body of ${page}`, () => {
      // Drug tests reports a parked write through useToast, so the page needs
      // the provider to mount at all.
      const { container } = render(
        React.createElement(ToastProvider, null, React.createElement(Hr, { page })),
      )
      expect(container.textContent ?? '').toMatch(marker)
    })
  }
})
