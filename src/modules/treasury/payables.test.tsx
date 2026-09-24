// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render as rtl, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactElement } from 'react'
import PayablesTab from './PayablesTab'
import type { BankAccount, Purchase, Supplier } from '../../data/types'

/**
 * Paying a supplier is a receipt, not a click: the date, the account and the
 * check number are the record, and what was paid stays visible under Paid.
 */
vi.mock('../../components/DocumentUpload', () => ({ default: () => null }))
vi.mock('../../lib/auth', () => ({ useAuth: () => ({ seat: { id: 'seat-t', name: 'Tess Treasurer' } }) }))

afterEach(cleanup)

// Rows link to their purchase, so the tab needs a router around it.
const render = (ui: ReactElement) => rtl(<MemoryRouter>{ui}</MemoryRouter>)

const suppliers = [{ id: 'v1', name: 'Petron Bulk' } as Supplier]
const bankAccounts = [{ id: 'b1', bankName: 'BDO', accountNumberMasked: '••1234' } as BankAccount]
const purchase = (installments: Purchase['installments']): Purchase => ({
  id: 'p1', createdAt: '', updatedAt: '', supplierId: 'v1', date: '2026-09-01T00:00:00.000Z', pricePerLiter: 50,
  volumeLiters: 10_000, fulfillment: 'delivered', warehouseId: 'w1', status: 'received', paymentMode: 'check',
  poReferenceNo: 'PO-77', installments,
} as unknown as Purchase)

describe('Payables', () => {
  it('opens a receipt on Pay and asks for the check number before it saves', async () => {
    const onPay = vi.fn().mockResolvedValue(undefined)
    const p = purchase([{ id: 'i1', amount: 500_000, principal: 500_000, interestPct: 0, dueDate: '2026-09-10T00:00:00.000Z', status: 'pending' }])
    render(<PayablesTab purchases={[p]} suppliers={suppliers} bankAccounts={bankAccounts} onPay={onPay} />)
    fireEvent.click(screen.getByRole('button', { name: 'Pay' }))
    const dlg = screen.getByRole('dialog', { name: 'Pay supplier' })
    fireEvent.click(within(dlg).getByRole('button', { name: 'Record payment' }))
    expect(await within(dlg).findByText(/Record the check number/)).toBeTruthy()
    expect(onPay).not.toHaveBeenCalled()

    fireEvent.change(within(dlg).getByLabelText('Check no.'), { target: { value: '0012345' } })
    fireEvent.change(within(dlg).getByLabelText('From account'), { target: { value: 'b1' } })
    fireEvent.change(within(dlg).getByLabelText('Date paid'), { target: { value: '2026-09-12' } })
    fireEvent.click(within(dlg).getByRole('button', { name: 'Record payment' }))
    await waitFor(() => expect(onPay).toHaveBeenCalled())
    const [pid, iid, patch] = onPay.mock.calls[0]
    expect([pid, iid]).toEqual(['p1', 'i1'])
    expect(patch).toMatchObject({ status: 'paid', paymentMode: 'check', referenceNo: '0012345', bankAccountId: 'b1', paidBy: 'seat-t', paidByName: 'Tess Treasurer' })
    expect(patch.paidAt.slice(0, 10)).toBe('2026-09-12')
  })

  it('cash needs no account; a transfer needs one but no reference', async () => {
    const onPay = vi.fn().mockResolvedValue(undefined)
    const p = purchase([{ id: 'i1', amount: 1, principal: 1, interestPct: 0, dueDate: '2026-09-10T00:00:00.000Z', status: 'pending' }])
    render(<PayablesTab purchases={[p]} suppliers={suppliers} bankAccounts={bankAccounts} onPay={onPay} />)
    fireEvent.click(screen.getByRole('button', { name: 'Pay' }))
    const dlg = screen.getByRole('dialog', { name: 'Pay supplier' })
    fireEvent.change(within(dlg).getByLabelText('How'), { target: { value: 'bank_transfer' } })
    fireEvent.change(within(dlg).getByLabelText('From account'), { target: { value: '' } })
    fireEvent.click(within(dlg).getByRole('button', { name: 'Record payment' }))
    expect(await within(dlg).findByText(/which account/)).toBeTruthy()
    fireEvent.change(within(dlg).getByLabelText('How'), { target: { value: 'cash' } })
    expect(within(dlg).queryByLabelText('From account')).toBeNull()
    fireEvent.click(within(dlg).getByRole('button', { name: 'Record payment' }))
    await waitFor(() => expect(onPay).toHaveBeenCalled())
    expect(onPay.mock.calls[0][2]).toMatchObject({ status: 'paid', paymentMode: 'cash' })
    expect(onPay.mock.calls[0][2].bankAccountId).toBeUndefined()
  })

  it('keeps what was paid under Paid, with how, from where and by whom', () => {
    const paidAt = new Date(Date.now() - 2 * 86_400_000).toISOString()
    const p = purchase([
      { id: 'i1', amount: 250_000, principal: 250_000, interestPct: 0, dueDate: '2026-09-10T00:00:00.000Z', status: 'pending' },
      { id: 'i2', amount: 250_000, principal: 250_000, interestPct: 0, dueDate: '2026-08-10T00:00:00.000Z', status: 'paid', paidAt, paymentMode: 'check', referenceNo: '0012345', bankAccountId: 'b1', paidByName: 'Tess Treasurer' },
    ])
    render(<PayablesTab purchases={[p]} suppliers={suppliers} bankAccounts={bankAccounts} onPay={vi.fn()} />)
    expect(screen.getByRole('button', { name: /^due\s*1$/i })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^paid\s*1$/i }))
    expect(screen.getByText('0012345')).toBeTruthy()
    expect(screen.getByText('BDO ••1234')).toBeTruthy()
    expect(screen.getByText('Tess Treasurer')).toBeTruthy()
    expect(screen.getByText(/after due/)).toBeTruthy()
    // Narrow the window past it and it drops out; All brings it back.
    fireEvent.change(screen.getByLabelText('How far back'), { target: { value: '0' } })
    expect(screen.getByText('0012345')).toBeTruthy()
  })
})
