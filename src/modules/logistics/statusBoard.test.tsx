// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import StatusBoard from './StatusBoard'
import { addDaysISO, todayISO } from '../../lib/format'
import type { Delivery } from '../../data/types'

/**
 * Three working columns grouped by day, a narrow ledger of the week's
 * concluded trips, and a drop into the next column that is the same handoff
 * as the card's button.
 */
// Built on the local calendar day the board itself reads (todayISO), not the
// UTC clock: after 4pm Manila time the two disagree and "today" is tomorrow.
const at = (offsetDays: number) => `${addDaysISO(todayISO(), offsetDays)}T00:00:00.000Z`
const trip = (over: Partial<Delivery>): Delivery => ({
  id: 'd1', createdAt: '', updatedAt: '', saleId: 's1', scheduleDate: at(0),
  deliveryAddress: 'Pasig', contactPerson: '', contactNumber: '', status: 'scheduled', ...over,
})
const names: Record<string, string> = { s1: 'Cielo Transport', s2: 'Lakbay Bus', s3: 'Bayan Fleet' }
const props = () => ({
  customerOf: (d: Delivery) => names[d.saleId],
  driverOf: () => 'J. Santos',
  plateOf: () => 'ABC 1234',
  litersOf: () => 8000,
  onAdvance: vi.fn(),
  onOpen: vi.fn(),
})
const dt = () => {
  const store: Record<string, string> = {}
  return { setData: (k: string, v: string) => { store[k] = v }, getData: (k: string) => store[k] ?? '', effectAllowed: '', dropEffect: '' }
}

afterEach(cleanup)

describe('Status board', () => {
  it('groups a column by day, overdue first', () => {
    render(<StatusBoard {...props()} deliveries={[
      trip({ id: 'a', saleId: 's1' }),
      trip({ id: 'b', saleId: 's2', scheduleDate: at(-2) }),
      trip({ id: 'c', saleId: 's3', scheduleDate: at(1) }),
    ]} />)
    const col = screen.getByRole('region', { name: 'Scheduled' })
    const labels = [...col.querySelectorAll('p.uppercase')].map((p) => p.textContent?.replace(/\d+$/, ''))
    expect(labels).toEqual(['Overdue', 'Today', 'Tomorrow'])
    expect(within(col).getByText('2d late')).toBeTruthy()
    // The header carries the real count and the litres in the column.
    expect(within(col).getByText('3')).toBeTruthy()
    expect(within(col).getByText('24,000 L')).toBeTruthy()
  })

  it('lists concluded trips of the week as one-line entries that reopen', () => {
    const p = props()
    const done = trip({ id: 'ok', saleId: 's1', status: 'delivered' })
    render(<StatusBoard {...p} deliveries={[
      done,
      trip({ id: 'no', saleId: 's2', status: 'failed', scheduleDate: at(-1) }),
      trip({ id: 'old', saleId: 's3', status: 'delivered', scheduleDate: at(-10) }),
    ]} />)
    const rail = screen.getByRole('region', { name: 'Concluded' })
    expect(within(rail).getByRole('button', { name: 'Cielo Transport, delivered' })).toBeTruthy()
    expect(within(rail).getByRole('button', { name: 'Lakbay Bus, failed' })).toBeTruthy()
    expect(within(rail).queryByText('Bayan Fleet')).toBeNull()
    fireEvent.click(within(rail).getByRole('button', { name: 'Cielo Transport, delivered' }))
    expect(p.onOpen).toHaveBeenCalledWith(done)
  })

  it('keeps a late trip on the ledger by the day it was closed, not the day it was booked', () => {
    // Booked two weeks ago, delivered this morning. Filtering on the schedule
    // date made this vanish the moment it was marked delivered.
    render(<StatusBoard {...props()} deliveries={[
      trip({ id: 'late', saleId: 's1', status: 'delivered', scheduleDate: at(-14), outcome: { completedAt: at(0) } }),
    ]} />)
    const rail = screen.getByRole('region', { name: 'Concluded' })
    expect(within(rail).getByRole('button', { name: 'Cielo Transport, delivered' })).toBeTruthy()
  })

  it('lets the ledger reach further back, and a column show everything', () => {
    const p = props()
    const many = Array.from({ length: 15 }, (_, i) => trip({ id: `s${i}`, saleId: 's1', status: 'loading', scheduleDate: at(i) }))
    render(<StatusBoard {...p} deliveries={[
      ...many,
      trip({ id: 'old', saleId: 's3', status: 'delivered', scheduleDate: at(-10) }),
    ]} />)
    const rail = screen.getByRole('region', { name: 'Concluded' })
    expect(within(rail).queryByText('Bayan Fleet')).toBeNull()
    fireEvent.change(within(rail).getByRole('combobox'), { target: { value: '30' } })
    expect(within(rail).getByText('Bayan Fleet')).toBeTruthy()

    const col = screen.getByRole('region', { name: 'Loading' })
    expect(within(col).getAllByText('Cielo Transport')).toHaveLength(12)
    fireEvent.click(within(col).getByRole('button', { name: 'Show 3 more' }))
    expect(within(col).getAllByText('Cielo Transport')).toHaveLength(15)
  })

  it('advances a trip dropped into the next column, and only the next', () => {
    const p = props()
    const d = trip({ id: 'a', saleId: 's1' })
    render(<StatusBoard {...p} deliveries={[d]} />)
    const card = screen.getByRole('button', { name: 'Cielo Transport, scheduled' })
    const transfer = dt()
    fireEvent.dragStart(card, { dataTransfer: transfer })
    // Two columns ahead: nothing happens.
    const transit = screen.getByRole('region', { name: 'In transit' })
    fireEvent.dragOver(transit, { dataTransfer: transfer })
    fireEvent.drop(transit, { dataTransfer: transfer })
    expect(p.onAdvance).not.toHaveBeenCalled()
    // The next column: the same handoff as the Load button.
    const loading = screen.getByRole('region', { name: 'Loading' })
    fireEvent.dragOver(loading, { dataTransfer: transfer })
    expect(within(loading).getByText('Drop to load')).toBeTruthy()
    fireEvent.drop(loading, { dataTransfer: transfer })
    expect(p.onAdvance).toHaveBeenCalledWith(d, 'loading')
  })

  it('keeps the one-press next step on the card', () => {
    const p = props()
    const d = trip({ id: 'a', saleId: 's1', status: 'in_transit' })
    render(<StatusBoard {...p} deliveries={[d]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delivery' }))
    expect(p.onAdvance).toHaveBeenCalledWith(d, 'delivered')
    expect(p.onOpen).not.toHaveBeenCalled()
  })
})
