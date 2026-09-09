// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import ChecklistEditor from './ChecklistEditor'
import { CHECKLIST_ITEMS } from '../../lib/logistics'
import type { Delivery, PreDispatchChecklist } from '../../data/types'

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

  it('ticks every item at once', () => {
    const onChange = view()
    fireEvent.click(screen.getByRole('button', { name: 'Tick all' }))
    expect(onChange).toHaveBeenCalledTimes(1)
    const next = onChange.mock.calls[0][0] as PreDispatchChecklist
    expect(CHECKLIST_ITEMS.every((i) => next[i.key] === true)).toBe(true)
  })
})
