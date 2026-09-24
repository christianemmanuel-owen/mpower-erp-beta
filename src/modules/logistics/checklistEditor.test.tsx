// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import ChecklistEditor from './ChecklistEditor'
import { CHECKLIST_ITEMS } from '../../lib/logistics'
import type { Delivery, PreDispatchChecklist } from '../../data/types'

vi.mock('../../lib/auth', () => ({ useAuth: () => ({ seat: { id: 'seat1', name: 'Grace Villanueva' } }) }))

afterEach(cleanup)

const trip: Delivery = {
  id: 'W5E9dgauS4',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  saleId: 's1',
  scheduleDate: '2026-09-12',
  deliveryAddress: 'Valenzuela depot',
  contactPerson: 'R. Cruz',
  contactNumber: '0917 000 0000',
  status: 'scheduled',
}

const view = (checklist?: PreDispatchChecklist, onChange = vi.fn()) => {
  render(
    <ChecklistEditor
      draft={{ ...trip, checklist }}
      personnel={[]}
      trucks={[]}
      onChange={onChange}
      onNotice={() => {}}
    />,
  )
  return onChange
}

describe('ChecklistEditor', () => {
  it('counts the ticks in the header instead of naming three of them', () => {
    view({ loadConfirmed: true, gpsPresent: true } as PreDispatchChecklist)
    expect(screen.getByText(`2 of ${CHECKLIST_ITEMS.length} ticked`)).toBeTruthy()
    // The old copy listed the first three outstanding labels and "+7 more",
    // which was neither the whole list nor a number worth acting on.
    expect(screen.queryByText(/still unticked/)).toBeNull()
    expect(screen.queryByText(/\+\d+ more/)).toBeNull()
  })

  /** An opaque row id is not information a dispatcher can use; it was printed
   *  under the button purely because it was to hand. */
  it('does not print the trip id at the reader', () => {
    view()
    expect(screen.queryByText(new RegExp(trip.id))).toBeNull()
  })

  it('shows what printing will do, then the number it allocated', () => {
    view()
    expect(screen.getByText(/allocates a checklist number/)).toBeTruthy()

    cleanup()
    view({ referenceNo: 'PDC-000123' } as PreDispatchChecklist)
    expect(screen.getByText('PDC-000123')).toBeTruthy()
    expect(screen.queryByText(/allocates a checklist number/)).toBeNull()
  })

  it('gives notes a textarea, not a one-line input', () => {
    view()
    const notes = screen.getByLabelText('Notes')
    expect(notes.tagName).toBe('TEXTAREA')
  })

  /** The client's rule: no shortcut. Every box starts empty and is ticked by
   *  the person who looked. */
  it('offers no way to tick everything at once', () => {
    view()
    expect(screen.queryByRole('button', { name: /tick all/i })).toBeNull()
    expect(CHECKLIST_ITEMS.some((i) => i.label === 'Brakes')).toBe(true)
    expect(screen.getByRole('checkbox', { name: 'Brakes' })).toBeTruthy()
    expect(screen.getAllByRole('checkbox').every((c) => !(c as HTMLInputElement).checked)).toBe(true)
  })

  it('asks the driver, pahinante and dispatch personnel to sign on screen', () => {
    view()
    expect(screen.getByRole('img', { name: 'Driver signature pad' })).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Pahinante signature pad' })).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Dispatch personnel signature pad' })).toBeTruthy()
    expect(screen.getByText(/still to sign/)).toBeTruthy()
  })
})
