// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '../../components/Toast'
import type { Delivery } from '../../data/types'

const trip = (over: Partial<Delivery> = {}): Delivery => ({
  id: 'd1', createdAt: '', updatedAt: '',
  saleId: 's1', scheduleDate: new Date().toISOString(), status: 'loading',
  deliveryAddress: 'Km 21 MacArthur Hwy, Valenzuela',
  contactPerson: 'R. Cruz', contactNumber: '0917 555 0148',
  truckId: 't1', driverId: 'p-driver', pahinanteId: 'p-me',
  ...over,
} as Delivery)

let trips: Delivery[] = []
// Typed loosely on purpose: the assertions below read the patch it was handed.
const update = vi.fn(async (_id: string, _patch: Partial<Delivery>) => ({}))

vi.mock('../../lib/data', () => ({
  useTables: () => ({
    deliveries: trips,
    trucks: [{ id: 't1', plateNumber: 'ABC 1234' }],
    personnel: [{ id: 'p-driver', name: 'J. Santos' }, { id: 'p-me', name: 'R. Reyes' }],
  }),
}))
vi.mock('../../data/repo', () => ({
  repos: { deliveries: { update: (id: string, patch: Partial<Delivery>) => update(id, patch) } },
}))
vi.mock('../../lib/auth', async (original) => ({
  ...(await original<typeof import('../../lib/auth')>()),
  useAuth: () => ({
    seat: { id: 'seat-crew', name: 'R. Reyes', scope: 'own', personnelId: 'p-me' },
    ready: true, login: async () => null, logout: () => {},
  }),
}))
// The uploader queries the attachments API; the screen under test is the sheet.
vi.mock('../../components/DocumentUpload', () => ({ default: () => <div>uploader</div> }))

import MyTrips from './MyTrips'

afterEach(() => { cleanup(); update.mockClear(); trips = [] })

const view = () => render(
  <QueryClientProvider client={new QueryClient()}>
    <ToastProvider><MyTrips /></ToastProvider>
  </QueryClientProvider>,
)

describe('My trips', () => {
  it('says what each trip still needs, on the row', () => {
    trips = [trip({ checklist: { loadConfirmed: true } as Delivery['checklist'] })]
    view()
    expect(screen.getByText(/Checklist 1 of 21 complete/)).toBeTruthy()
  })

  /**
   * Dispatch's decisions are facts here, not fields. The server refuses a crew
   * seat's write to them by name, so offering them would be offering a control
   * whose every save fails.
   */
  it('shows the truck and crew as facts, with nothing to edit', () => {
    trips = [trip()]
    view()
    fireEvent.click(screen.getByRole('button', { name: 'Dispatch' }))
    expect(screen.getByText('ABC 1234')).toBeTruthy()
    expect(screen.getAllByText('J. Santos').length).toBeGreaterThan(0)
    expect(screen.queryByDisplayValue('ABC 1234')).toBeNull()
  })

  it('records a checklist tick as the person who ticked it', async () => {
    trips = [trip()]
    view()
    fireEvent.click(screen.getByRole('button', { name: 'Dispatch' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Fuel load matches the orders' }))
    await waitFor(() => expect(update).toHaveBeenCalled())
    expect(update.mock.calls[0]?.[1]).toMatchObject({ checklist: { loadConfirmed: true } })
  })

  /** Typing a receipt number and tapping Confirm delivery has to be one write,
   *  or the trip is filed delivered with its reference still in a text box. */
  it('files the receipt in the same write that confirms the delivery', async () => {
    // The DR number was typed at dispatch; at the customer it is shown, not
    // asked for again.
    trips = [trip({ status: 'in_transit', documents: { deliveryReceipt: { referenceNo: 'DR-2026-00500' } } })]
    view()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delivery' }))
    expect(screen.getByText('DR-2026-00500')).toBeTruthy()
    expect(screen.queryByPlaceholderText('e.g. DR-2026-00187')).toBeNull()
    fireEvent.change(screen.getByPlaceholderText('Name on the signed copy'), { target: { value: 'A. Dela Cruz' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delivery' }))

    await waitFor(() => expect(update).toHaveBeenCalled())
    const patch = update.mock.calls[0]?.[1] as Delivery
    expect(patch.status).toBe('delivered')
    expect(patch.documents?.deliveryReceipt?.referenceNo).toBe('DR-2026-00500')
    expect(patch.receivedBy).toBe('A. Dela Cruz')
    // Stamped as the person, which is the point of giving crew a login.
    expect(patch.stamps?.delivery?.byName).toBe('R. Reyes')
  })

  it('shows what is still missing as chips, and asks before going on without it', () => {
    trips = [trip({ status: 'in_transit' })]
    view()
    // The list row's button opens the trip; inside, the gap is named above
    // the stage button as a chip rather than a sentence.
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delivery' }))
    expect(screen.getByRole('status', { name: /Still needs Who signed/ })).toBeTruthy()
    const go = screen.getByRole('button', { name: 'Confirm delivery' }) as HTMLButtonElement
    expect(go.disabled).toBe(false)
    // Pressing it with a gap asks first, listing the same gaps.
    fireEvent.click(go)
    const sheet = screen.getByRole('dialog', { name: 'Something is missing' })
    expect(within(sheet).getByText('Who signed')).toBeTruthy()
    expect(within(sheet).getByRole('button', { name: 'Continue anyway' })).toBeTruthy()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Go back and fill it in' }))
    expect(screen.queryByRole('dialog', { name: 'Something is missing' })).toBeNull()
  })

  /**
   * "Now" is what is still moving, not what is dated today: a trip that was
   * scheduled yesterday and never delivered is still the crew's problem.
   */
  it('separates what is still running from what is finished', () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString()
    trips = [
      trip(),
      trip({ id: 'd2', status: 'delivered', scheduleDate: yesterday, deliveryAddress: 'Cavite depot' }),
      trip({ id: 'd3', status: 'in_transit', scheduleDate: yesterday, deliveryAddress: 'Laguna run' }),
    ]
    view()
    expect(screen.getByText('Km 21 MacArthur Hwy, Valenzuela')).toBeTruthy()
    expect(screen.getByText('Laguna run')).toBeTruthy()
    expect(screen.queryByText('Cavite depot')).toBeNull()

    expect(screen.getByRole('tab', { name: 'Current, 2' })).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Past, 1' }))
    expect(screen.getByText('Cavite depot')).toBeTruthy()
    expect(screen.queryByText('Laguna run')).toBeNull()
  })

  /** A season of trips is not a list you scroll. */
  it('searches the list and grows it on demand', async () => {
    trips = Array.from({ length: 20 }, (_, i) =>
      trip({ id: `d${i}`, deliveryAddress: i === 19 ? 'Tarlac plant' : `Stop ${i}` }))
    view()
    // Beyond the first window, so it can only be reached by searching or by
    // asking for more.
    expect(screen.queryByText('Tarlac plant')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    fireEvent.change(screen.getByLabelText('Address, plate or receipt'), { target: { value: 'tarlac' } })
    expect(await screen.findByText('Tarlac plant')).toBeTruthy()
    expect(screen.queryByText('Stop 0')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Close search' }))
    fireEvent.click(await screen.findByRole('button', { name: /Show \d+ more/ }))
    expect(await screen.findByText('Tarlac plant')).toBeTruthy()
  })
})

describe('Dispatch on the phone', () => {
  it('takes the DR number at dispatch and files it with the handoff', async () => {
    trips = [trip({ status: 'loading', movementType: 'delivery_to_client' })]
    view()
    fireEvent.click(screen.getByRole('button', { name: 'Dispatch' }))
    // The gap is one this screen can close.
    expect(screen.getByRole('status', { name: /Delivery receipt number/ })).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText('e.g. DR-2026-00187'), { target: { value: 'DR-2026-00777' } })
    expect(screen.getByRole('status', { name: /Still needs/ }).getAttribute('aria-label')).not.toMatch(/receipt number/)
    fireEvent.click(screen.getByRole('button', { name: 'Dispatch' }))
    // Checklist gaps remain, so it asks; go ahead anyway.
    fireEvent.click(screen.getByRole('button', { name: 'Continue anyway' }))
    await waitFor(() => expect(update).toHaveBeenCalled())
    const patch = update.mock.calls[0]?.[1] as Delivery
    expect(patch.status).toBe('in_transit')
    expect(patch.documents?.deliveryReceipt?.referenceNo).toBe('DR-2026-00777')
  })
})
