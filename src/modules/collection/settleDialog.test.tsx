// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import SettleDialog from './SettleDialog'
import type { BankAccount, CollectionStatus, Customer, Personnel, Sale } from '../../data/types'

// The document slots talk to the attachments API, which has nothing to do with
// what the form asks for before it will save.
vi.mock('../../components/DocumentUpload', () => ({ default: () => null }))

afterEach(cleanup)

const sale: Sale = {
  id: 's1', createdAt: '', updatedAt: '', agentId: 'a1', customerId: 'c1',
  date: '2026-01-02T00:00:00.000Z', pricePerLiter: 55, volumeLiters: 10_000,
  warehouseId: 'w1', fulfillment: 'delivery', paymentMode: 'check', status: 'fulfilled',
  installments: [{ id: 'i1', dueDate: '2026-02-02T00:00:00.000Z', amount: 550_000, status: 'pending' }],
} as unknown as Sale

const customers = [{ id: 'c1', company: 'Metro Mix Concrete' } as Customer]
const personnel = [{ id: 'p1', name: 'Dina Cruz' } as Personnel]
const bankAccounts: BankAccount[] = []

function open(preset?: CollectionStatus) {
  const onSave = vi.fn().mockResolvedValue(undefined)
  render(
    <SettleDialog
      entry={{ sale, installment: sale.installments[0], preset }}
      sales={[sale]}
      customers={customers}
      personnel={personnel}
      bankAccounts={bankAccounts}
      onClose={vi.fn()}
      onSave={onSave}
      onNotice={vi.fn()}
    />,
  )
  return onSave
}

const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save' }))

describe('settling a collection', () => {
  /**
   * Dropping a card into a column is how most settlements start, so the form
   * opens on the outcome that was dropped rather than making you pick it a
   * second time.
   */
  it('opens on the outcome it was handed', () => {
    open('bounced')
    expect(screen.getByRole('radio', { name: /Bounced/ }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('radio', { name: /Collected/ }).getAttribute('aria-checked')).toBe('false')
  })

  it('defaults to collected when it was opened without one', () => {
    open()
    expect(screen.getByRole('radio', { name: /Collected/ }).getAttribute('aria-checked')).toBe('true')
  })

  /**
   * The gap this covers: a drag into Bounced used to write the status straight
   * through, with no reason attached. The account's credit history is built
   * out of these, so an unexplained one is worth nothing a year later.
   */
  it('will not record a bounce with no reason', async () => {
    const onSave = open('bounced')
    save()
    expect(await screen.findByText(/Give a reason for the bounce/)).toBeTruthy()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('will not write off a receivable with no reason', async () => {
    const onSave = open('cancelled')
    save()
    expect(await screen.findByText(/can’t be defended later/)).toBeTruthy()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('saves the bounce once the reason is given', async () => {
    const onSave = open('bounced')
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Insufficient funds' } })
    save()
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    const [, , patch] = onSave.mock.calls[0]
    expect(patch.status).toBe('bounced')
    expect(patch.notes).toBe('Insufficient funds')
    // Nothing arrived, so nothing is stamped as having arrived.
    expect(patch.collectedAt).toBeUndefined()
  })

  it('will not record a collection with no date', async () => {
    const onSave = open('collected')
    fireEvent.change(screen.getByLabelText('Date collected'), { target: { value: '' } })
    save()
    expect(await screen.findByText(/Record the date the money arrived/)).toBeTruthy()
    expect(onSave).not.toHaveBeenCalled()
  })
})

describe('viewing only', () => {
  it('shows a treasurer the collection without letting them settle it', () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(
      <SettleDialog
        entry={{ sale, installment: sale.installments[0] }}
        sales={[sale]} customers={customers} personnel={personnel} bankAccounts={bankAccounts}
        onClose={vi.fn()} onSave={onSave} onNotice={vi.fn()} readOnly
      />,
    )
    expect(screen.getByText(/Viewing only/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    expect(screen.getByRole('dialog').querySelectorAll('input:enabled, select:enabled, textarea:enabled').length).toBe(0)
  })
})
