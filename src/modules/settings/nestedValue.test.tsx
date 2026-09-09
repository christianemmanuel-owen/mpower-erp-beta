// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import NestedValue from './NestedValue'
import { enumFor, groupFor, nameOf } from '../../lib/approvalFields'

afterEach(cleanup)

const INSTALLMENTS = [
  { id: 'h0u7wDYa', principal: 33689, amount: 35373, interestPct: 5, dueDate: '2026-10-04T00:00:00.000Z', status: 'pending' },
  { id: 'k2p9xQ', principal: 33689, amount: 35373, interestPct: 5, dueDate: '2026-11-04T00:00:00.000Z', status: 'collected' },
]

describe('NestedValue', () => {
  it('draws an installment schedule as a table, not as JSON', () => {
    // It used to be JSON.stringify in a <pre>, so an approver deciding whether
    // to post a sale was reading `"principal": 33689,` off the screen.
    const { container } = render(<NestedValue value={INSTALLMENTS} />)
    expect(container.querySelector('table')).toBeTruthy()
    expect(container.textContent).not.toContain('"principal"')
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2)
  })

  it('formats money, percentages and dates rather than printing raw values', () => {
    const { container } = render(<NestedValue value={INSTALLMENTS} />)
    const text = container.textContent ?? ''
    expect(text).toContain('35,373')
    expect(text).toContain('5%')
    expect(text).not.toContain('2026-10-04T00:00:00.000Z')
  })

  it('drops the id column, which an approver cannot act on', () => {
    const { container } = render(<NestedValue value={INSTALLMENTS} />)
    expect(container.textContent).not.toContain('h0u7wDYa')
  })

  it('lines up rows that do not all carry the same optional fields', () => {
    const { container } = render(
      <NestedValue value={[{ amount: 1 }, { amount: 2, collectorId: 'p1' }]} />,
    )
    expect(container.querySelectorAll('thead th')).toHaveLength(2)
    expect(container.querySelectorAll('tbody tr')[0].querySelectorAll('td')).toHaveLength(2)
  })

  it('says so when there is nothing in the list', () => {
    render(<NestedValue value={[]} />)
    expect(screen.getByText('None.')).toBeTruthy()
  })

  it('renders a plain object as labelled rows', () => {
    const { container } = render(<NestedValue value={{ treatment: 'written_off', volumeReturned: 400 }} />)
    expect(container.querySelector('table')).toBeNull()
    expect(container.textContent).toContain('Written off')
    expect(container.textContent).toContain('400')
  })
})

describe('nameOf', () => {
  it('names a bank account by bank and masked number, not by its id', () => {
    // BankAccount has no `name` field, so the picker listed raw ids.
    expect(nameOf({ id: 'b1', bankName: 'BPI', accountNumberMasked: '••1234' }, 'b1')).toBe('BPI ••1234')
  })

  it('falls back to the raw id so a dangling reference is visible', () => {
    expect(nameOf(undefined, 'wh-gone')).toBe('wh-gone')
  })
})

describe('field rules', () => {
  it('gives closed fields their real options, per table', () => {
    // A sale is fulfilled by 'delivery' and a purchase by 'delivered'. Rendered
    // as free text, both were a typo away from a 422.
    expect(enumFor('sales', 'fulfillment')).toContain('delivery')
    expect(enumFor('purchases', 'fulfillment')).toContain('delivered')
    expect(enumFor('sales', 'status')).toContain('confirmed')
    expect(enumFor('purchases', 'status')).not.toContain('confirmed')
  })

  it('leaves open text alone', () => {
    expect(enumFor('sales', 'clientPoReferenceNo')).toBeNull()
  })

  it('puts an unmapped field somewhere rather than losing it', () => {
    // The approvable tables are configurable, so unmapped fields are expected.
    expect(groupFor('somethingNobodyMapped')).toBe('Details')
    expect(groupFor('customerId')).toBe('Parties')
    expect(groupFor('installments')).toBe('Payment')
  })
})
