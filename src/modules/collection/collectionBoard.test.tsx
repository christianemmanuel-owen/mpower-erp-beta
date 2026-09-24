// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, within } from '@testing-library/react'
import CollectionBoard from './CollectionBoard'
import { saleInstallmentEntries } from '../../lib/metrics'
import type { CollectionStatus, Customer, Sale } from '../../data/types'

afterEach(cleanup)

const customers: Customer[] = [
  { id: 'c1', company: 'Metro Mix Concrete' } as Customer,
  { id: 'c2', company: 'Lakbay Bus Lines' } as Customer,
]

const sale = (id: string, customerId: string, status: CollectionStatus): Sale => ({
  id, createdAt: '', updatedAt: '', agentId: 'a1', customerId,
  date: '2026-01-02T00:00:00.000Z', pricePerLiter: 55, volumeLiters: 10_000,
  warehouseId: 'w1', fulfillment: 'delivery', paymentMode: 'check', status: 'fulfilled',
  installments: [{ id: `${id}-i1`, dueDate: '2026-02-02T00:00:00.000Z', amount: 550_000, status }],
} as unknown as Sale)

/** The four columns, in the order the board lays them out. */
const COLUMNS = ['pending', 'collected', 'bounced', 'cancelled'] as const

function board(sales: Sale[]) {
  const onMove = vi.fn()
  const { container } = render(
    <CollectionBoard
      entries={saleInstallmentEntries(sales)}
      customer={(id) => customers.find((c) => c.id === id)}
      agentName={() => 'Dina Cruz'}
      collectorName={() => 'Dina Cruz'}
      onMove={onMove}
    />,
  )
  const cols = [...container.querySelectorAll('.grid > div')] as HTMLElement[]
  const col = (status: typeof COLUMNS[number]) => cols[COLUMNS.indexOf(status)]
  /** How many cards the column's heading says it holds. */
  const count = (status: typeof COLUMNS[number]) => within(col(status)).getAllByText(/^\d+$/)[0].textContent
  const drag = (company: string, to: typeof COLUMNS[number]) => {
    const card = within(container).getByText(company).closest('[draggable]')!
    fireEvent.dragStart(card, { dataTransfer: { setData: vi.fn() } })
    fireEvent.drop(col(to))
  }
  return { onMove, container, col, count, drag }
}

describe('the collections board', () => {
  /**
   * The regression this file exists for.
   *
   * A single-payment sale that bounced has nothing left open. The board used
   * to be handed only the sales with an open receivable, so that sale never
   * reached it and the Bounced column - the one place the failure is supposed
   * to show - stayed empty while the money was demonstrably not collected.
   */
  it('shows an installment that bounced, even when its sale has nothing left open', () => {
    const b = board([sale('s1', 'c1', 'bounced')])
    expect(within(b.col('bounced')).getByText('Metro Mix Concrete')).toBeTruthy()
    expect(b.count('bounced')).toBe('1')
    expect(b.count('pending')).toBe('0')
  })

  it('files each installment under its own outcome', () => {
    const b = board([sale('s1', 'c1', 'bounced'), sale('s2', 'c2', 'pending')])
    expect(b.count('bounced')).toBe('1')
    expect(b.count('pending')).toBe('1')
    expect(b.count('collected')).toBe('0')
  })

  /**
   * A drag asks for an outcome; it does not record one. The caller opens the
   * settle dialog on what was asked for, which is where the reason and the
   * reference number get typed.
   */
  it('asks for the outcome the card was dropped on', () => {
    const b = board([sale('s1', 'c1', 'pending')])
    b.drag('Metro Mix Concrete', 'bounced')
    expect(b.onMove).toHaveBeenCalledWith('s1', 's1-i1', 'bounced')
  })

  it('ignores a card dropped back in the column it came from', () => {
    const b = board([sale('s1', 'c1', 'pending')])
    b.drag('Metro Mix Concrete', 'pending')
    expect(b.onMove).not.toHaveBeenCalled()
  })
})
