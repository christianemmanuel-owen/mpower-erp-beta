// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '../../components/Toast'
import type { Sale, SaleInstallment } from '../../data/types'

const day = 86_400_000
const iso = (offset: number) => new Date(Date.now() + offset * day).toISOString()

const sale = (installments: Partial<SaleInstallment>[], over: Partial<Sale> = {}): Sale => ({
  id: over.id ?? 's1', createdAt: '', updatedAt: '',
  agentId: 'a1', customerId: 'c1', date: iso(-30),
  pricePerLiter: 52, volumeLiters: 8000, warehouseId: 'w1',
  fulfillment: 'delivery', paymentMode: 'check', status: 'fulfilled',
  collectorId: 'p-me',
  installments: installments.map((i, n) => ({
    id: `i${n + 1}`, principal: 100_000, interestPct: 0, amount: 100_000,
    dueDate: iso(-2), status: 'pending', ...i,
  })) as SaleInstallment[],
  ...over,
} as Sale)

let sales: Sale[] = []
const update = vi.fn(async (_id: string, _patch: Record<string, unknown>) => ({ ok: true }))

vi.mock('../../lib/data', () => ({
  useTables: () => ({
    sales,
    customers: [{
      id: 'c1', company: 'Metro Mix Concrete', address: 'Pasig City',
      contactPerson: 'J. Tan', contactNumber: '0917 555 0308',
    }],
  }),
}))
vi.mock('../../data/repo', () => ({
  repos: { sales: { update: (id: string, p: Record<string, unknown>) => update(id, p) } },
}))
vi.mock('../../components/PhotoCapture', () => ({ default: () => null }))
vi.mock('../../lib/auth', async (original) => ({
  ...(await original<typeof import('../../lib/auth')>()),
  useAuth: () => ({
    seat: { id: 'seat-c', name: 'Dina Cruz', scope: 'own', personnelId: 'p-me' },
    ready: true, login: async () => null, logout: () => {},
  }),
}))

import MyCollections from './MyCollections'

afterEach(() => { cleanup(); update.mockClear(); sales = [] })

const view = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider><MyCollections /></ToastProvider>
  </QueryClientProvider>,
)

/** Tabs carry their count in the accessible name: "In hand, 3". */
const tab = (name: RegExp) => screen.getAllByRole('tab').find((b) => name.test(b.getAttribute('aria-label') ?? ''))!

/** A row is a button wrapping the customer name. */
const row = (name: string) => screen.getByText(name).closest('button')!

describe('the collector’s round', () => {
  it('opens on what is still to be collected', () => {
    sales = [sale([{}])]
    view()
    expect(screen.getByText('Metro Mix Concrete')).toBeTruthy()
    expect(screen.getByText(/Overdue/)).toBeTruthy()
  })

  /**
   * The tab this screen exists for. A check in a collector's bag was
   * indistinguishable from money in the bank under the old model, including to
   * the collector carrying it - this is their own custody position.
   */
  it('keeps what is in hand on its own tab, and says what has to happen to it', () => {
    sales = [sale([{ status: 'collected', collectedAt: iso(-1), checkDate: iso(-1) }])]
    view()
    fireEvent.click(tab(/^In hand/))
    expect(screen.getByText(/hand to Treasury/)).toBeTruthy()
  })

  /** A post-dated check still in the bag cannot be handed over to be banked
   *  yet, and saying so stops a pointless trip to the office. */
  it('says when a post-dated check becomes bankable', () => {
    sales = [sale([{ status: 'collected', collectedAt: iso(-1), checkDate: iso(+12) }])]
    view()
    fireEvent.click(tab(/^In hand/))
    expect(screen.getByText(/bankable/)).toBeTruthy()
  })

  it('shows only the installments assigned to this collector', () => {
    sales = [
      sale([{}], { id: 's1' }),
      sale([{}], { id: 's2', collectorId: 'p-someone-else' }),
    ]
    view()
    expect(screen.getAllByText('Metro Mix Concrete')).toHaveLength(1)
  })

  /**
   * The check's own date is the one fact only the person holding it can read,
   * and it is what decides when Treasury may bank it - so the collector
   * is asked for it at the point of collection and nowhere else.
   */
  it('records the check number and the date on its face', async () => {
    sales = [sale([{}])]
    view()
    fireEvent.click(row('Metro Mix Concrete'))
    fireEvent.change(screen.getByLabelText('Check number'), { target: { value: 'BPI-887214' } })
    // Regex, not the exact string: FieldField puts its hint inside the <label>,
    // so the accessible name is the label text plus the hint.
    fireEvent.change(screen.getByLabelText(/Date on the check/), { target: { value: '2026-10-15' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(update).toHaveBeenCalled())
    const [, patch] = update.mock.calls[0] as [string, { installments: SaleInstallment[] }]
    const saved = patch.installments[0]
    expect(saved.status).toBe('collected')
    expect(saved.referenceNo).toBe('BPI-887214')
    expect(saved.checkDate?.slice(0, 10)).toBe('2026-10-15')
    // Emphatically not deposited: a collector cannot bank their own collection.
    expect(saved.depositedAt).toBeUndefined()
  })

  it('will not record a failed visit with no reason', async () => {
    sales = [sale([{}])]
    view()
    fireEvent.click(row('Metro Mix Concrete'))
    fireEvent.click(screen.getByRole('button', { name: 'Not yet' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText(/Say why you could not collect/)).toBeTruthy()
    expect(update).not.toHaveBeenCalled()
  })

  /** Already collected: there is nothing left for the collector to do to it,
   *  so the form is replaced by what happened. */
  it('offers no form on something already collected', () => {
    sales = [sale([{ status: 'collected', collectedAt: iso(-1) }])]
    view()
    fireEvent.click(tab(/^In hand/))
    fireEvent.click(row('Metro Mix Concrete'))
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    expect(screen.getByText(/Collected/)).toBeTruthy()
  })
})
