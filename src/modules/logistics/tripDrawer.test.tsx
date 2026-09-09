// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import TripDrawer from './TripDrawer'
import type { Delivery, Personnel, Seat, Truck } from '../../data/types'

afterEach(cleanup)

vi.mock('../../data/repo', () => ({ repos: { deliveries: { update: vi.fn() } } }))

// Only useAuth is replaced - the rest of the module (canAccess, MODULES) is
// still the real thing, since other components in the drawer's tree use it.
vi.mock('../../lib/auth', async (original) => ({
  ...(await original<typeof import('../../lib/auth')>()),
  useAuth: () => ({
    seat: { id: 'seat1', name: 'M. Reyes' } as Seat,
    ready: true,
    login: async () => null,
    logout: () => {},
  }),
}))

const trip: Delivery = {
  id: 'd1',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  saleId: 's1',
  scheduleDate: '2026-09-12',
  deliveryAddress: 'Valenzuela depot',
  contactPerson: 'R. Cruz',
  contactNumber: '0917 000 0000',
  status: 'scheduled',
}

const props = {
  personnel: [] as Personnel[],
  trucks: [] as Truck[],
  deliveries: [trip],
  maintenance: [],
  banRules: [],
  onClose: () => {},
  onNotice: () => {},
  onAdvance: async () => {},
}

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
const Drawer = (p: Parameters<typeof TripDrawer>[0]) => (
  <QueryClientProvider client={client}><TripDrawer {...p} /></QueryClientProvider>
)

const open = (over: Partial<Delivery>, onAdvance = vi.fn(async () => {})) => {
  render(<Drawer {...props} delivery={{ ...trip, ...over }} onAdvance={onAdvance} />)
  return onAdvance
}

/** Scoped to one stage: the left-hand nav lists the same four names, so an
 *  unscoped query for "Dispatch" finds the jump link as well as the action. */
const stage = (title: string) => within(screen.getByRole('region', { name: title }))

describe('TripDrawer stages', () => {
  /** The action belongs to the stage the trip is actually on. Offering all
   *  three at once is how a dispatcher confirms a delivery for a truck that has
   *  not left the yard. */
  it('offers only the current stage its action', () => {
    open({ status: 'loading' })
    expect(stage('Dispatch').getByRole('button', { name: 'Dispatch' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Start loading' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Confirm delivery' })).toBeNull()
  })

  it('warns about what is missing without disabling the action', () => {
    open({ status: 'scheduled' })
    const go = screen.getByRole('button', { name: 'Start loading' }) as HTMLButtonElement
    expect(go.disabled).toBe(false)
    expect(screen.getByText('Needs a truck and a driver.')).toBeTruthy()
  })

  it('carries unsaved edits into the advance', () => {
    const onAdvance = open({ status: 'in_transit' })
    fireEvent.change(screen.getByPlaceholderText('Name on the receipt'), { target: { value: 'A. Dela Cruz' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delivery' }))
    expect(onAdvance).toHaveBeenCalledWith('delivered', expect.objectContaining({ receivedBy: 'A. Dela Cruz' }))
  })

  /** 'failed' was a status the board could display and nothing could reach. */
  it('can mark a trip failed, and reopen one', () => {
    const onAdvance = open({ status: 'in_transit' })
    fireEvent.click(screen.getByRole('button', { name: 'Mark failed' }))
    expect(onAdvance).toHaveBeenCalledWith('failed', expect.anything())

    cleanup()
    const again = open({ status: 'failed' })
    fireEvent.click(screen.getByRole('button', { name: 'Reopen trip' }))
    expect(again).toHaveBeenCalledWith('in_transit', expect.anything())
  })

  it('asks a failed trip why', () => {
    open({ status: 'failed' })
    expect(screen.getByText(/say why/)).toBeTruthy()
  })
})

describe('TripDrawer', () => {
  /**
   * The drawer is mounted for the whole page and handed `delivery: null` while
   * closed. If the null check sits above the hooks, opening a trip adds hooks
   * mid-life and React throws "rendered more hooks than during the previous
   * render" - the drawer never appears. This is the sequence that catches it,
   * so it must go null -> trip, not straight to a trip.
   */
  it('opens after having been closed', () => {
    const { rerender } = render(<Drawer {...props} delivery={null} />)
    expect(screen.queryByRole('dialog')).toBeNull()

    rerender(<Drawer {...props} delivery={trip} />)
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByText('Valenzuela depot', { exact: false })).toBeTruthy()
  })

  it('starts a fresh edit buffer for each trip', () => {
    const { rerender } = render(<Drawer {...props} delivery={trip} />)
    const address = screen.getByDisplayValue('Valenzuela depot') as HTMLInputElement
    expect(address.value).toBe('Valenzuela depot')

    const other: Delivery = { ...trip, id: 'd2', deliveryAddress: 'Batangas depot' }
    rerender(<Drawer {...props} delivery={other} />)
    expect((screen.getByDisplayValue('Batangas depot') as HTMLInputElement).value).toBe('Batangas depot')
  })
})
