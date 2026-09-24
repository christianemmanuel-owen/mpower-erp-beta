// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '../../components/Toast'
import type { Sale } from '../../data/types'

const sale = (over: Partial<Sale> = {}): Sale => ({
  id: 's1', createdAt: '', updatedAt: '',
  agentId: 'a-me', customerId: 'c1', date: new Date().toISOString(),
  pricePerLiter: 52, volumeLiters: 8000, warehouseId: 'w1',
  fulfillment: 'delivery', paymentMode: 'bank_transfer', status: 'confirmed',
  installments: [{
    id: 'i1', principal: 416_000, interestPct: 0, amount: 416_000,
    dueDate: new Date(Date.now() + 10 * 86_400_000).toISOString(), status: 'pending',
  }],
  ...over,
} as Sale)

let sales: Sale[] = []
let parked: { id: string; tbl: string; action: string; summary: string; requestedAt: string }[] = []
/** What the session carries, when the server has resolved it. */
let seatAgentId: string | undefined
let personnel: Record<string, unknown>[] = [{ id: 'p-me', name: 'J. dela Cruz', agentId: 'a-me' }]
// Parks the submission the way the server does, so what the screen shows after
// recording is what an agent would actually see.
const add = vi.fn(async (_data: Record<string, unknown>) => {
  parked.push({
    id: `ap${parked.length + 1}`, tbl: 'sales', action: 'create',
    summary: 'sale to Cielo Transport, 8,000 L', requestedAt: new Date().toISOString(),
  })
  return { pending: true, message: 'Sent for approval.' }
})

vi.mock('../../lib/data', () => ({
  useTables: () => ({
    sales,
    customers: [
      { id: 'c1', company: 'Cielo Transport', paymentTermDays: 30 },
      { id: 'c2', company: 'Batangas Haulers', paymentTermDays: 15 },
    ],
    warehouses: [{ id: 'w1', name: 'Valenzuela depot' }],
    bankAccounts: [{ id: 'b1', bankName: 'BPI', accountNumberMasked: '••4021' }],
    personnel,
    products: [],
  }),
}))
vi.mock('../../data/repo', () => ({
  repos: { sales: { add: (d: Record<string, unknown>) => add(d) } },
}))
vi.mock('../../lib/approvals', async (original) => ({
  ...(await original<typeof import('../../lib/approvals')>()),
  useApprovals: () => ({ data: { rows: parked, pendingCount: 0 }, refetch: () => {} }),
}))
vi.mock('../../lib/auth', async (original) => ({
  ...(await original<typeof import('../../lib/auth')>()),
  useAuth: () => ({
    seat: { id: 'seat-agent', name: 'J. dela Cruz', scope: 'own', personnelId: 'p-me', agentId: seatAgentId },
    ready: true, login: async () => null, logout: () => {},
  }),
}))

import MySales from './MySales'

afterEach(() => {
  cleanup(); add.mockClear(); sales = []; parked = []
  personnel = [{ id: 'p-me', name: 'J. dela Cruz', agentId: 'a-me' }]
})

const view = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider><MySales /></ToastProvider>
  </QueryClientProvider>,
)

const fill = () => {
  fireEvent.click(screen.getByRole('button', { name: /New sale/ }))
  fireEvent.change(screen.getByLabelText('Customer'), { target: { value: 'c1' } })
  fireEvent.change(screen.getByLabelText('Litres'), { target: { value: '8000' } })
  fireEvent.change(screen.getByLabelText('Total price'), { target: { value: '416000' } })
  fireEvent.change(screen.getByLabelText('Receiving account'), { target: { value: 'b1' } })
}

describe('My sales', () => {
  /** The screen opens on what is still owed, because that is what an agent
   *  comes here to chase. */
  it('opens on what is still to collect', () => {
    sales = [sale()]
    view()
    expect(screen.getByRole('tab', { name: 'Outstanding, 1' })).toBeTruthy()
    expect(screen.getByText('Cielo Transport')).toBeTruthy()
    expect(screen.getByText(/^Due /)).toBeTruthy()
  })

  /** An installment past its due date is the thing an agent opens this screen for. */
  it('sorts an overdue sale to the top and says so in red', () => {
    sales = [
      sale({ id: 's2', customerId: 'c1' }),
      sale({
        id: 's1',
        installments: [{
          id: 'i1', principal: 416_000, interestPct: 0, amount: 416_000,
          dueDate: new Date(Date.now() - 5 * 86_400_000).toISOString(), status: 'pending',
        }],
      }),
    ]
    view()
    expect(screen.getByText(/Overdue \d+ d/)).toBeTruthy()
    const rows = screen.getAllByRole('button').filter((b) => b.textContent?.includes('Cielo Transport'))
    expect(rows[0].textContent).toMatch(/Overdue \d+ d/)
  })

  /** A settled book is a good outcome, and says so rather than showing nothing. */
  /** The three figures an agent opens the app for, before any tab is touched. */
  it('leads with outstanding, overdue and pending figures', () => {
    sales = [
      sale({ id: 's1' }),
      sale({ id: 's2', installments: [{
        id: 'i1', principal: 312_000, interestPct: 0, amount: 312_000,
        dueDate: new Date(Date.now() - 15 * 86_400_000).toISOString(), status: 'pending',
      }] }),
    ]
    parked = [{ id: 'ap1', tbl: 'sales', action: 'create', summary: 'sale to Cielo Transport', requestedAt: new Date().toISOString() }]
    view()
    expect(screen.getByText('₱728k')).toBeTruthy()
    expect(screen.getByText('₱312k')).toBeTruthy()
    expect(screen.getByText('Overdue 15 d')).toBeTruthy()
  })

  /** The All tab is a sales log: total, litres, and where the sale stands. */
  it('shows the sale total and status on the All tab', () => {
    sales = [sale({ installments: [{
      id: 'i1', principal: 416_000, interestPct: 0, amount: 416_000,
      dueDate: new Date().toISOString(), status: 'collected',
    }] })]
    view()
    fireEvent.click(screen.getByRole('tab', { name: 'All, 1' }))
    expect(screen.getByText('₱416,000')).toBeTruthy()
    expect(screen.getByText(/8,000 L/)).toBeTruthy()
    expect(screen.getByText('Paid')).toBeTruthy()
  })

  it('says when there is nothing left to collect', () => {
    sales = [sale({ installments: [{
      id: 'i1', principal: 416_000, interestPct: 0, amount: 416_000,
      dueDate: new Date().toISOString(), status: 'collected',
    }] })]
    view()
    expect(screen.getByText(/All sales are settled/)).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'All, 1' }))
    expect(screen.getByText('Cielo Transport')).toBeTruthy()
  })

  /**
   * The sale an agent just recorded is parked in the approvals queue, not in the
   * sales table. Without this group the screen would look like the submission
   * had been thrown away.
   */
  it('shows a submission that is waiting for approval, and does not pretend it opens', () => {
    parked = [{
      id: 'ap1', tbl: 'sales', action: 'create',
      summary: 'sale to Cielo Transport, 8,000 L', requestedAt: new Date().toISOString(),
    }]
    view()
    fireEvent.click(screen.getByRole('tab', { name: 'Pending, 1' }))
    const row = screen.getByText(/Cielo Transport/).closest('div')!
    expect(within(row).getByText(/^Submitted /)).toBeTruthy()
    // Not a record yet, so there is no page behind it - and no tappable row.
    expect(screen.getByText(/Cielo Transport/).closest('button')).toBeNull()
  })

  /** Recording one and then hunting for it is the whole failure this avoids. */
  it('lands on the Waiting tab after recording a sale', async () => {
    view()
    fill()
    fireEvent.click(screen.getByRole('button', { name: /Record sale/ }))
    await waitFor(() => expect(add).toHaveBeenCalledTimes(1))
    expect((screen.getByRole('tab', { name: /^Pending/ }) as HTMLElement).getAttribute('aria-selected')).toBe('true')
  })

  it('searches a long list and grows it on demand', async () => {
    sales = Array.from({ length: 20 }, (_, i) => sale({ id: `s${i}`, customerId: i === 19 ? 'c2' : 'c1' }))
    view()
    expect(screen.queryByText('Batangas Haulers')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    fireEvent.change(screen.getByLabelText('Customer, litres or PO no.'), { target: { value: 'batangas' } })
    expect(await screen.findByText('Batangas Haulers')).toBeTruthy()
    expect(screen.queryByText('Cielo Transport')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Close search' }))
    fireEvent.click(await screen.findByRole('button', { name: /Show 5 more/ }))
    expect(await screen.findByText('Batangas Haulers')).toBeTruthy()
  })

  /** Never asked for, never offered: the agent is the seat. */
  it('files the sale under the seat’s own agent, deriving the price per litre', async () => {
    view()
    fill()
    fireEvent.click(screen.getByRole('button', { name: /Record sale/ }))
    await waitFor(() => expect(add).toHaveBeenCalledTimes(1))
    expect(add.mock.calls[0]?.[0]).toMatchObject({
      agentId: 'a-me', customerId: 'c1', volumeLiters: 8000, pricePerLiter: 52, status: 'draft',
    })
    expect(screen.queryByLabelText(/agent/i)).toBeNull()
  })

  it('carries the total on the button that commits it', () => {
    view()
    fill()
    expect(screen.getByRole('button', { name: /Record sale · ₱416,000/ })).toBeTruthy()
  })

  it('names every empty field at once rather than one per attempt', async () => {
    view()
    fireEvent.click(screen.getByRole('button', { name: /New sale/ }))
    fireEvent.click(screen.getByRole('button', { name: /Record sale/ }))
    expect(screen.getByText('Select a customer.')).toBeTruthy()
    expect(screen.getByText('Enter the volume in litres.')).toBeTruthy()
    expect(add).not.toHaveBeenCalled()
  })

  /**
   * Sale.agentId points at an Agent record and a login points at a Personnel
   * one; without the bridge between them the server refuses every sale this
   * seat files, for not being theirs.
   */
  /**
   * The server strips `Personnel.agentId` for seats without HR access - every
   * field seat - so the screen has to take the agent from the session. Reading
   * it off the employee row put every real agent on the "not linked" screen.
   */
  it('takes the agent from the session when the employee row does not carry it', () => {
    personnel = [{ id: 'p-me', name: 'J. dela Cruz' }]
    seatAgentId = 'a-me'
    try {
      view()
      fireEvent.click(screen.getByRole('button', { name: /New sale/ }))
      expect(screen.getByLabelText('Customer')).toBeTruthy()
    } finally {
      seatAgentId = undefined
    }
  })

  it('says so when the seat has no agent record behind it', () => {
    personnel = [{ id: 'p-me', name: 'J. dela Cruz' }]
    view()
    fireEvent.click(screen.getByRole('button', { name: /New sale/ }))
    expect(screen.getByText(/is not linked to a sales agent record/)).toBeTruthy()
    expect(screen.queryByLabelText('Customer')).toBeNull()
  })
})
