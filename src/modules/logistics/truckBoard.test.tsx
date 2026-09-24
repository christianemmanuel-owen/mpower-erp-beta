// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import TruckBoard, { dropHour } from './TruckBoard'
import type { Delivery, Truck } from '../../data/types'
import { addDaysISO, todayISO } from '../../lib/format'

// The board reads the day from the first ten characters of scheduleDate and
// compares them to the local calendar day, so the fixtures are built the
// same way - a UTC clock here made every test fail after 4pm Manila time.
const TODAY = todayISO()
const TOMORROW = `${addDaysISO(TODAY, 1)}T00:00:00.000Z`

/**
 * The client's picture of the fleet: a rectangle per truck, trips dropped in,
 * ticked when done. The drop books the truck; the tick is the same advance
 * the status board makes, so both views agree.
 */
const trucks: Truck[] = [
  { id: 't1', plateNumber: 'ABC 1234', capacityLiters: 10_000, createdAt: '', updatedAt: '' },
  { id: 't2', plateNumber: 'XYZ 9876', capacityLiters: 12_000, createdAt: '', updatedAt: '' },
]
const trip = (over: Partial<Delivery>): Delivery => ({
  id: 'd1', createdAt: '', updatedAt: '', saleId: 's1', scheduleDate: `${TODAY}T00:00:00.000Z`,
  deliveryAddress: 'Pasig', contactPerson: '', contactNumber: '', status: 'scheduled', ...over,
})

const props = () => ({
  trucks,
  customerOf: (d: Delivery) => (d.saleId === 's1' ? 'Cielo Transport' : 'Lakbay Bus'),
  driverOf: () => 'J. Santos',
  litersOf: () => 8000,
  workshopOn: () => new Set<string>(),
  onAssign: vi.fn(),
  onAdvance: vi.fn(),
  onOpen: vi.fn(),
})

afterEach(cleanup)

/** jsdom has no DataTransfer; a stub carrying one string is enough. */
const dt = () => {
  const store: Record<string, string> = {}
  return { setData: (k: string, v: string) => { store[k] = v }, getData: (k: string) => store[k] ?? '', effectAllowed: '', dropEffect: '' }
}

describe('Truck board', () => {
  it('puts each trip in its truck and the rest in the tray', () => {
    render(<TruckBoard {...props()} deliveries={[trip({ truckId: 't1' }), trip({ id: 'd2', saleId: 's2' })]} />)
    expect(within(screen.getByRole('list', { name: 'Trips for ABC 1234' })).getByText('Cielo Transport')).toBeTruthy()
    expect(within(screen.getByRole('list', { name: 'Trips to book' })).getByText('Lakbay Bus')).toBeTruthy()
    expect(within(screen.getByRole('list', { name: 'Trips for XYZ 9876' })).queryAllByRole('listitem')).toHaveLength(0)
    // The day ruler and the day itself.
    expect(screen.getByRole('button', { name: 'Today' })).toBeTruthy()
  })

  it('books a truck when a tray trip is dropped on it, then opens its drawer', async () => {
    const p = props()
    const d = trip({ id: 'd2', saleId: 's2' })
    render(<TruckBoard {...p} deliveries={[d]} />)
    const chip = screen.getByRole('listitem', { name: /Lakbay Bus/ })
    const transfer = dt()
    fireEvent.dragStart(chip, { dataTransfer: transfer })
    const target = screen.getByRole('list', { name: 'Trips for XYZ 9876' })
    fireEvent.dragOver(target, { dataTransfer: transfer })
    fireEvent.drop(target, { dataTransfer: transfer })
    // jsdom lays nothing out, so the drop carries no hour: the truck alone.
    expect(p.onAssign).toHaveBeenCalledWith(d, { truckId: 't2' })
    await vi.waitFor(() => expect(p.onOpen).toHaveBeenCalledWith({ ...d, truckId: 't2' }))
  })

  it('shows the tray across days, with the day each trip was wanted for', () => {
    const tomorrow = TOMORROW
    render(<TruckBoard {...props()} deliveries={[trip({ id: 'd2', saleId: 's2', scheduleDate: tomorrow })]} />)
    expect(screen.getByRole('listitem', { name: /Lakbay Bus, wanted .*, to book/ })).toBeTruthy()
    expect(screen.getByText(/To book · 1/)).toBeTruthy()
  })

  it('unbooks a trip dropped back on the tray, and does not re-send a block dropped where it was', () => {
    const p = props()
    const d = trip({ truckId: 't1' })
    render(<TruckBoard {...p} deliveries={[d]} />)
    const block = screen.getByRole('listitem', { name: /Cielo Transport/ })
    const transfer = dt()
    fireEvent.dragStart(block, { dataTransfer: transfer })
    const own = screen.getByRole('list', { name: 'Trips for ABC 1234' })
    fireEvent.dragOver(own, { dataTransfer: transfer })
    fireEvent.drop(own, { dataTransfer: transfer })
    expect(p.onAssign).not.toHaveBeenCalled()
    fireEvent.dragStart(block, { dataTransfer: transfer })
    const tray = screen.getByRole('list', { name: 'Trips to book' })
    fireEvent.dragOver(tray, { dataTransfer: transfer })
    fireEvent.drop(tray, { dataTransfer: transfer })
    // null, not undefined: the server merges the body, so a missing key
    // would leave the truck booked.
    expect(p.onAssign).toHaveBeenCalledWith(d, { truckId: null })
    expect(p.onOpen).not.toHaveBeenCalled()
  })

  it('books onto the shown day by its date string, not through the local clock', () => {
    // The trip was wanted tomorrow; the board is on today. jsdom lays
    // nothing out, so the hour is untouched and only the day moves - and it
    // moves in the ten characters every board filters on.
    const p = props()
    const tomorrow = TOMORROW
    const d = trip({ id: 'd2', saleId: 's2', scheduleDate: tomorrow })
    render(<TruckBoard {...p} deliveries={[d]} />)
    const transfer = dt()
    fireEvent.dragStart(screen.getByRole('listitem', { name: /Lakbay Bus/ }), { dataTransfer: transfer })
    const target = screen.getByRole('list', { name: 'Trips for XYZ 9876' })
    fireEvent.dragOver(target, { dataTransfer: transfer })
    fireEvent.drop(target, { dataTransfer: transfer })
    const today = TODAY
    expect(p.onAssign).toHaveBeenCalledWith(d, { truckId: 't2', scheduleDate: `${today}${tomorrow.slice(10)}` })
  })

  it('turns where a block was dropped into a half-hour departure', () => {
    // A 480px row is the whole day: 20px an hour.
    expect(dropHour(0, 0, 480)).toBe(0)
    expect(dropHour(150, 0, 480)).toBe(7.5)
    expect(dropHour(162, 0, 480)).toBe(8)
    expect(dropHour(1000, 0, 480)).toBe(23.5)
    expect(dropHour(10, 0, 0)).toBe(null)
  })

  it('ticks a trip on the road as delivered, or crosses it as failed', () => {
    const p = props()
    const d = trip({ truckId: 't1', status: 'in_transit' })
    render(<TruckBoard {...p} deliveries={[d]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Mark Cielo Transport delivered' }))
    expect(p.onAdvance).toHaveBeenCalledWith(d, 'delivered')
    fireEvent.click(screen.getByRole('button', { name: 'Mark Cielo Transport failed' }))
    expect(p.onAdvance).toHaveBeenCalledWith(d, 'failed')
  })

  it('moves between days and only shows that day', () => {
    const tomorrow = TOMORROW
    render(<TruckBoard {...props()} deliveries={[trip({ truckId: 't1' }), trip({ id: 'd2', saleId: 's2', truckId: 't1', scheduleDate: tomorrow })]} />)
    expect(screen.getByText('Cielo Transport')).toBeTruthy()
    expect(screen.queryByText('Lakbay Bus')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Next day' }))
    expect(screen.queryByText('Cielo Transport')).toBeNull()
    expect(screen.getByText('Lakbay Bus')).toBeTruthy()
  })

  it('shows a concluded trip ticked and faded, with nothing left to press', () => {
    render(<TruckBoard {...props()} deliveries={[trip({ truckId: 't1', status: 'delivered' })]} />)
    const chip = screen.getByRole('listitem', { name: /Cielo Transport.*delivered/ })
    expect(chip.className).toContain('opacity-60')
    expect(within(chip).getByLabelText('Delivered')).toBeTruthy()
    expect(within(chip).queryByRole('button', { name: /Mark/ })).toBeNull()
    expect(chip.getAttribute('draggable')).toBe('false')
  })
})
