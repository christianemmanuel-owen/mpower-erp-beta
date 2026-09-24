// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { ToastProvider } from '../../components/Toast'
import { queryClient } from '../../lib/queryClient'

/**
 * The client's Purchases comments: a row opens the purchase (1); price per
 * litre beside volume, computing the total (2); a third-party hauler with who,
 * when, how much, how paid and whether paid (6); product types with an Other
 * (7); the supplier's agent and depot shown in the form (8); COD / 7 / 15 / 30
 * day terms (9); depot and master totals after the order (10).
 */

const RANGE = { from: '2026-07-01T00:00:00.000Z', to: '2026-07-31T23:59:59.999Z' }
vi.mock('../../lib/range', () => ({ useRange: () => ({ range: RANGE, setRange: vi.fn() }), RangePicker: () => null }))
vi.mock('../../lib/auth', () => ({ useAuth: () => ({ seat: { id: 'seat1', name: 'Ramon', isAdmin: true, modules: ['inventory'] } }), canAccess: () => true }))
vi.mock('../settings/Approvals', () => ({ PendingBanner: () => null }))
vi.mock('../../lib/quickCreate', () => ({ useQuickCreate: () => ({ pending: null, request: vi.fn(), consume: () => false }), CreateAction: () => null }))
vi.mock('../../lib/deepLink', () => ({ usePendingRecord: () => [null, vi.fn()], recordHref: (tbl: string, id: string) => `/${tbl}/${id}` }))
vi.mock('../../components/DocumentUpload', () => ({ default: ({ slots }: { slots: string[] }) => <div data-testid="uploads">{slots.join(',')}</div> }))

const add = vi.fn(async (d: Record<string, unknown>) => ({ id: 'new', ...d }))
const update = vi.fn(async (_id: string, d: Record<string, unknown>) => ({ id: 'p1', ...d }))
vi.mock('../../data/repo', () => ({
  repos: { purchases: { add: (d: Record<string, unknown>) => add(d), update: (id: string, d: Record<string, unknown>) => update(id, d) } },
}))

const TABLES: Record<string, unknown[]> = {
  warehouses: [
    { id: 'w1', name: 'Valenzuela depot', capacityLiters: 100_000 },
    { id: 'w2', name: 'Batangas depot', capacityLiters: 80_000 },
  ],
  suppliers: [{
    id: 'sup1', name: 'Petrolink Bulk', contactPerson: 'Office', contactNumber: '02-1234', address: 'Makati', paymentTermDays: 15,
    agentName: 'Mia Santos', agentContact: '0917 555 0101', depotName: 'Petrolink Pandacan', depotAddress: 'Jesus St, Pandacan',
  }],
  customers: [], bankAccounts: [{ id: 'b1', bankName: 'BPI', accountNumberMasked: '••4021' }], products: [], stockThresholds: [],
  purchases: [{
    id: 'p1', createdAt: '', updatedAt: '', supplierId: 'sup1', warehouseId: 'w1',
    date: '2026-07-03T00:00:00.000Z', receivedAt: '2026-07-03T00:00:00.000Z',
    pricePerLiter: 50, volumeLiters: 20_000, volumeReceived: 20_000,
    fulfillment: 'delivered', status: 'received', paymentMode: 'cash',
    installments: [{ id: 'i1', principal: 1_000_000, interestPct: 0, amount: 1_000_000, dueDate: '2026-07-03T00:00:00.000Z', status: 'paid' }],
  }],
  sales: [],
}
vi.mock('../../lib/data', () => ({
  useTables: (keys: readonly string[]) => Object.fromEntries(keys.map((k) => [k, TABLES[k] ?? []])),
  useTable: (k: string) => TABLES[k] ?? [],
}))

import Inventory from './Inventory'

const view = () => render(
  <QueryClientProvider client={queryClient}><ToastProvider><MemoryRouter><Inventory page="purchases" /></MemoryRouter></ToastProvider></QueryClientProvider>,
)
afterEach(() => { cleanup(); add.mockClear(); update.mockClear() })

const dialog = () => screen.getByRole('dialog')
const field = (name: string | RegExp) => within(dialog()).getByLabelText(name) as HTMLInputElement | HTMLSelectElement

describe('Purchase form', () => {
  it('opens a purchase from anywhere on its row', () => {
    view()
    fireEvent.click(screen.getByText('Petrolink Bulk'))
    expect(screen.getByRole('dialog', { name: 'Edit purchase' })).toBeTruthy()
    // The row's own buttons are still their own thing.
    expect(within(dialog()).getByTestId('uploads').textContent).toContain('supplierInvoice')
    expect(within(dialog()).getByTestId('uploads').textContent).toContain('permitToLoad')
  })

  it('computes the total from volume × price per litre, and back', () => {
    view()
    fireEvent.click(screen.getByText('Petrolink Bulk'))
    fireEvent.change(field('Volume (L)'), { target: { value: '10000' } })
    fireEvent.change(field('Price per litre (₱)'), { target: { value: '52.5' } })
    expect((field('Total price (₱)') as HTMLInputElement).value).toBe('525000')
    fireEvent.change(field('Total price (₱)'), { target: { value: '530000' } })
    expect((field('Price per litre (₱)') as HTMLInputElement).value).toBe('53')
    // And the volume re-prices from the per-litre figure.
    fireEvent.change(field('Volume (L)'), { target: { value: '20000' } })
    expect((field('Total price (₱)') as HTMLInputElement).value).toBe('1060000')
  })

  it('shows the supplier agent and loading depot, and the depot and master totals after the order', () => {
    view()
    fireEvent.click(screen.getByText('Petrolink Bulk'))
    expect(within(dialog()).getByText('Mia Santos')).toBeTruthy()
    expect(within(dialog()).getByText('Petrolink Pandacan')).toBeTruthy()
    // 20,000 L on hand at Valenzuela, editing the 20,000 L order: 40,000 after; master the same.
    expect(within(dialog()).getByText('Depot after').parentElement!.textContent).toContain('40,000 L')
    expect(within(dialog()).getByText('After this order').parentElement!.textContent).toContain('40,000 L')
    expect(within(dialog()).getAllByText(/space for/).length).toBeGreaterThan(0)
  })

  it('records a third-party hauler with who, when, how much, how and whether paid', async () => {
    view()
    fireEvent.click(screen.getByText('Petrolink Bulk'))
    fireEvent.change(field('Fulfillment'), { target: { value: 'hauler' } })
    fireEvent.change(field('Hauler'), { target: { value: 'Kargamento Trucking' } })
    fireEvent.change(field('Hauler contact'), { target: { value: '0918 000 1111' } })
    fireEvent.change(field('Pickup date'), { target: { value: '2026-07-04' } })
    fireEvent.change(field('Hauling fee (₱)'), { target: { value: '18000' } })
    fireEvent.change(field('Hauler payment'), { target: { value: 'paid' } })
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(update).toHaveBeenCalled())
    expect(update.mock.calls[0][1]).toMatchObject({
      fulfillment: 'hauler',
      hauler: { name: 'Kargamento Trucking', contact: '0918 000 1111', fee: 18000, paymentMode: 'bank_transfer', status: 'paid' },
    })
  })

  it('offers diesel, gasoline, LPG and a named Other', async () => {
    view()
    fireEvent.click(screen.getByText('Petrolink Bulk'))
    const product = field('Product') as HTMLSelectElement
    expect([...product.options].map((o) => o.text)).toEqual(['Diesel (ADO)', 'Gasoline', 'LPG', 'Other'])
    fireEvent.change(product, { target: { value: 'product-other' } })
    fireEvent.change(field('Product name'), { target: { value: 'Kerosene' } })
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(update).toHaveBeenCalled())
    expect(update.mock.calls[0][1]).toMatchObject({ productId: 'product-other', productLabel: 'Kerosene' })
  })

  it('sets the terms to COD, 7, 15 or 30 days with one press', () => {
    view()
    fireEvent.click(screen.getByText('Petrolink Bulk'))
    const terms = within(dialog()).getByRole('group', { name: 'Payment terms' })
    fireEvent.click(within(terms).getByRole('button', { name: '30 days' }))
    expect(within(terms).getByRole('button', { name: '30 days', pressed: true })).toBeTruthy()
    // One row, due 30 days after the purchase date.
    const dates = [...dialog().querySelectorAll('input[type="date"]')] as HTMLInputElement[]
    expect(dates.map((d) => d.value)).toContain('2026-08-02')
    expect(dates.filter((d) => d.value === '2026-08-02')).toHaveLength(1)
  })
})

describe('Haulers on file', () => {
  it('fills the hauler block from a saved hauler, and keeps the link on the purchase', async () => {
    TABLES.haulers = [{ id: 'h1', name: 'Kargamento Trucking', contactPerson: 'Dodong', contactNumber: '0918 000 1111', defaultFee: 18000, paymentMode: 'cash' }]
    try {
      view()
      fireEvent.click(screen.getByText('Petrolink Bulk'))
      fireEvent.change(field('Fulfillment'), { target: { value: 'hauler' } })
      fireEvent.change(field('Saved hauler'), { target: { value: 'h1' } })
      expect((field('Hauler') as HTMLInputElement).value).toBe('Kargamento Trucking')
      expect((field('Hauler contact') as HTMLInputElement).value).toBe('Dodong · 0918 000 1111')
      expect((field('Hauling fee (₱)') as HTMLInputElement).value).toBe('18000')
      expect((field('Hauler paid by') as HTMLSelectElement).value).toBe('cash')
      fireEvent.click(within(dialog()).getByRole('button', { name: 'Save changes' }))
      await waitFor(() => expect(update).toHaveBeenCalled())
      expect(update.mock.calls[0][1]).toMatchObject({ hauler: { haulerId: 'h1', name: 'Kargamento Trucking', fee: 18000 } })
    } finally {
      TABLES.haulers = []
    }
  })

  it('offers to keep a hauler typed by hand', () => {
    view()
    fireEvent.click(screen.getByText('Petrolink Bulk'))
    fireEvent.change(field('Fulfillment'), { target: { value: 'hauler' } })
    expect(within(dialog()).queryByLabelText(/Save .* to the haulers list/)).toBeNull()
    fireEvent.change(field('Hauler'), { target: { value: 'Bayan Haulers' } })
    expect(within(dialog()).getByLabelText('Save Bayan Haulers to the haulers list for next time')).toBeTruthy()
  })
})
