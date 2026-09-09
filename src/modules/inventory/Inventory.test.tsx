// @vitest-environment jsdom
import { ToastProvider } from '../../components/Toast'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { queryClient } from '../../lib/queryClient'
import Inventory from './Inventory'

/**
 * A smoke test for the Stock page, aimed squarely at the two sections added for
 * Exhibit A 1.2 - the per-depot ledger and the movement list.
 *
 * `tsc` proves the props line up; it cannot prove the page renders. Both new
 * sections derive their figures at render time from four tables at once, which
 * is exactly the kind of wiring that type-checks and then throws.
 */

const RANGE = { from: '2026-07-01T00:00:00.000Z', to: '2026-07-31T23:59:59.999Z' }

vi.mock('../../lib/range', () => ({
  useRange: () => ({ range: RANGE, setRange: vi.fn() }),
  RangePicker: () => null,
}))
vi.mock('../../lib/auth', () => ({
  useAuth: () => ({ seat: { id: 'seat1', name: 'Ramon', isAdmin: false, modules: ['inventory'] } }),
  canAccess: () => true,
}))
vi.mock('../settings/Approvals', () => ({ PendingBanner: () => null }))
vi.mock('../../lib/quickCreate', () => ({
  useQuickCreate: () => ({ pending: null, request: vi.fn(), consume: () => false }),
  // The page header renders this now; the button moved out of the top bar.
  CreateAction: () => null,
}))
vi.mock('../../lib/deepLink', () => ({
  usePendingRecord: () => [null, vi.fn()],
  recordHref: (tbl: string, id: string) => `/${tbl}/${id}`,
}))

const TABLES: Record<string, unknown[]> = {
  warehouses: [
    { id: 'w1', name: 'Valenzuela depot', capacityLiters: 100_000 },
    // Capacity 0 used to render "NaN%" in the old capacity cards.
    { id: 'w2', name: 'Cebu depot', capacityLiters: 0 },
  ],
  suppliers: [{ id: 'sup1', name: 'Petrolink Bulk' }],
  customers: [{ id: 'c1', company: 'Sunrise Bus Lines' }],
  bankAccounts: [], products: [], stockThresholds: [{ id: 't1', warehouseId: 'w1', thresholdLiters: 50_000, active: true }],
  purchases: [{
    id: 'p1', createdAt: '', updatedAt: '', supplierId: 'sup1', warehouseId: 'w1',
    date: '2026-06-28T00:00:00.000Z', receivedAt: '2026-07-03T00:00:00.000Z',
    pricePerLiter: 50, volumeLiters: 20_000, volumeReceived: 19_000,
    fulfillment: 'delivered', status: 'received', paymentMode: 'cash', installments: [],
  }],
  sales: [{
    id: 's1', createdAt: '', updatedAt: '', customerId: 'c1', warehouseId: 'w1',
    date: '2026-07-10T00:00:00.000Z', pricePerLiter: 60, volumeLiters: 4_000,
    status: 'fulfilled', paymentMode: 'cash', installments: [],
  }],
}

vi.mock('../../lib/data', () => ({
  useTables: (keys: readonly string[]) =>
    Object.fromEntries(keys.map((k) => [k, TABLES[k] ?? []])),
  useTable: (k: string) => TABLES[k] ?? [],
}))

function renderPage(page: 'levels' | 'purchases' | 'movements' | 'warnings' = 'levels') {
  render(
    <QueryClientProvider client={queryClient}>
      {/* The page's dialogs report a parked write through useToast, which needs
          its provider the same way they need a router. */}
      <ToastProvider>
        <MemoryRouter><Inventory page={page} /></MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

afterEach(cleanup)

/** Depot names appear in both the ledger and the movement list, so scope to the
 *  first table on the page - the depot ledger. */
const depotRow = (name: string) =>
  within(document.querySelectorAll('table')[0] as HTMLElement).getByText(name).closest('tr')!

describe('Stock page', () => {
  it('renders each subpage without throwing', () => {
    renderPage('levels')
    expect(screen.getByText('Depots')).toBeTruthy()
    cleanup()
    renderPage('movements')
    expect(screen.getByText('Movements')).toBeTruthy()
    cleanup()
    renderPage('purchases')
    expect(screen.getByText('Purchases')).toBeTruthy()
  })

  it('keeps warning levels off the Levels page now they have their own', () => {
    renderPage('levels')
    expect(screen.queryByText(/Low supply warnings/i)).toBeNull()
  })

  it('tells a non-admin who reaches the warnings URL directly, rather than showing a blank page', () => {
    // The sidebar hides the row, but a hidden row is not access control.
    renderPage('warnings')
    expect(screen.getByText(/set by an administrator/i)).toBeTruthy()
  })

  it('projects days of cover from the recent rate of sale', () => {
    // 19,000 in, 4,000 out over 31 days. The figure is what you reorder against.
    renderPage('levels')
    const row = depotRow('Valenzuela')
    expect(within(row).getByText(/days$/)).toBeTruthy()
  })

  it('says so plainly when a depot has no sales to project from', () => {
    // Cebu has no movements at all, so there is no rate. "No sales" beats a
    // made-up number and beats claiming infinite cover.
    renderPage('levels')
    expect(within(depotRow('Cebu')).getByText(/no sales/i)).toBeTruthy()
  })

  it('marks a depot below its warning level with an icon, not a sentence', () => {
    // Valenzuela holds 15,000 against a 50,000 level.
    renderPage('levels')
    expect(within(depotRow('Valenzuela')).getByLabelText(/below its .* warning level/i)).toBeTruthy()
    // The old prose is gone from the row entirely.
    expect(within(depotRow('Valenzuela')).queryByText(/warning level/i)?.tagName).not.toBe('P')
  })

  it('shows only its own subpage, so the scroll actually got shorter', () => {
    // The whole point of the split: Levels must not still be carrying the
    // purchases table and the movement ledger below the fold.
    renderPage('levels')
    expect(screen.getByText('Depots')).toBeTruthy()
    expect(screen.queryByText('Movements')).toBeNull()
    expect(screen.queryByText('Purchases')).toBeNull()
  })

  it('shows per-depot volume in and out - the half of 1.2 the old cards missed', () => {
    renderPage()
    const row = depotRow('Valenzuela')
    // Received 19,000 in July (by arrival date, though ordered in June), sold 4,000.
    expect(within(row).getByText(/19,000/)).toBeTruthy()
    expect(within(row).getByText(/4,000/)).toBeTruthy()
    expect(within(row).getByText(/\+15,000 L/)).toBeTruthy()
  })

  it('traces each movement to the record it came from', () => {
    renderPage('movements')
    expect(screen.getByText('Petrolink Bulk').closest('a')?.getAttribute('href')).toBe('/purchases/p1')
    expect(screen.getByText('Sunrise Bus Lines').closest('a')?.getAttribute('href')).toBe('/sales/s1')
  })

  it('does not render NaN% for a depot with no capacity recorded', () => {
    renderPage()
    const row = depotRow('Cebu')
    expect(within(row).getByText('not set')).toBeTruthy()
    expect(row.textContent).not.toMatch(/NaN/)
  })
})
