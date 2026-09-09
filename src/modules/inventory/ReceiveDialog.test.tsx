// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '../../lib/queryClient'
import ReceiveDialog from './ReceiveDialog'
import { repos } from '../../data/repo'
import type { Purchase } from '../../data/types'

/**
 * Receiving is the one place the ordered figure and the arrived figure can part
 * company, and stock on hand follows the arrived one. Getting this wrong doesn't
 * throw - it just makes every downstream number quietly wrong - so it is worth
 * testing at the seam rather than trusting the form.
 */
const purchase: Purchase = {
  id: 'p1',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  supplierId: 's1',
  date: '2026-08-01T00:00:00.000Z',
  pricePerLiter: 57,
  volumeLiters: 10_000,
  fulfillment: 'delivered',
  warehouseId: 'w1',
  status: 'ordered',
  paymentMode: 'bank_transfer',
  poReferenceNo: 'PO-2026-00041',
  installments: [
    { id: 'i1', principal: 570_000, interestPct: 0, amount: 570_000, dueDate: '2026-09-01T00:00:00.000Z', status: 'pending' },
  ],
}

function renderDialog(p: Purchase | null = purchase, onNotice = vi.fn()) {
  const onClose = vi.fn()
  render(
    <QueryClientProvider client={queryClient}>
      <ReceiveDialog purchase={p} onClose={onClose} onNotice={onNotice} />
    </QueryClientProvider>,
  )
  return { onClose, onNotice }
}

const volumeField = () => screen.getByLabelText(/volume received/i) as HTMLInputElement

beforeEach(() => {
  vi.spyOn(repos.purchases, 'update').mockResolvedValue(purchase)
  // The dialog embeds DocumentUpload, which fetches; keep it quiet.
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ rows: [] }), { status: 200, headers: { 'content-type': 'application/json' } }),
  )
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
})

describe('ReceiveDialog', () => {
  it('renders nothing when no purchase is being received', () => {
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <ReceiveDialog purchase={null} onClose={vi.fn()} onNotice={vi.fn()} />
      </QueryClientProvider>,
    )
    expect(container.innerHTML).toBe('')
  })

  it('pre-fills the ordered volume so a full delivery is one keystroke', () => {
    renderDialog()
    expect(volumeField().value).toBe('10000')
    expect(screen.getByText(/PO-2026-00041/)).toBeTruthy()
  })

  it('records the full order when the figure is left alone, without touching the plan', async () => {
    renderDialog()
    fireEvent.click(screen.getByRole('button', { name: /mark received/i }))
    await waitFor(() => expect(repos.purchases.update).toHaveBeenCalled())
    const [id, payload] = vi.mocked(repos.purchases.update).mock.calls[0]
    expect(id).toBe('p1')
    expect(payload).toMatchObject({ status: 'received', volumeReceived: 10_000 })
    // No `installments` key - an unchanged plan must not be rewritten, or every
    // routine receipt would park a no-op edit for approval.
    expect(payload).not.toHaveProperty('installments')
    // Stamped with when it actually landed, so volume-in counts against the
    // period the load arrived in rather than the one it was ordered in.
    expect(typeof (payload as { receivedAt?: string }).receivedAt).toBe('string')
    expect(Number.isNaN(Date.parse((payload as { receivedAt: string }).receivedAt))).toBe(false)
  })

  it('records a short delivery as what actually arrived', async () => {
    renderDialog()
    fireEvent.change(volumeField(), { target: { value: '9650' } })
    fireEvent.click(screen.getByRole('button', { name: /mark received/i }))
    await waitFor(() => expect(repos.purchases.update).toHaveBeenCalled())
    const [, patch] = vi.mocked(repos.purchases.update).mock.calls[0]
    expect(patch.volumeReceived).toBe(9650)
  })

  // ---- Q13: what MPower owes follows what arrived --------------------------

  it('reduces the unpaid installment to the value of the delivery', async () => {
    renderDialog()
    fireEvent.change(volumeField(), { target: { value: '9650' } })
    fireEvent.click(screen.getByRole('button', { name: /mark received/i }))
    await waitFor(() => expect(repos.purchases.update).toHaveBeenCalled())
    const [, patch] = vi.mocked(repos.purchases.update).mock.calls[0]
    expect(patch.installments?.[0].principal).toBe(550_050)
  })

  it('shows what will still be payable before the user commits', () => {
    // Half already paid, so "delivered" and "still to pay" are different numbers
    // and the breakdown has to show both.
    renderDialog({
      ...purchase,
      installments: [
        { id: 'i1', principal: 285_000, interestPct: 0, amount: 285_000, dueDate: '2026-09-01T00:00:00.000Z', status: 'paid' },
        { id: 'i2', principal: 285_000, interestPct: 0, amount: 285_000, dueDate: '2026-10-01T00:00:00.000Z', status: 'pending' },
      ],
    })
    fireEvent.change(volumeField(), { target: { value: '9650' } })
    expect(screen.getByText(/delivered/i)).toBeTruthy()
    expect(screen.getByText(/550,050/)).toBeTruthy()      // value of what arrived
    expect(screen.getByText(/already paid/i)).toBeTruthy()
    expect(screen.getByText(/still to pay/i)).toBeTruthy()
    expect(screen.getByText(/265,050/)).toBeTruthy()      // 550,050 − 285,000
  })

  it('leaves the plan alone when the adjustment is declined', async () => {
    renderDialog()
    fireEvent.change(volumeField(), { target: { value: '9650' } })
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: /mark received/i }))
    await waitFor(() => expect(repos.purchases.update).toHaveBeenCalled())
    const [, patch] = vi.mocked(repos.purchases.update).mock.calls[0]
    expect(patch.volumeReceived).toBe(9650)
    expect(patch.installments).toBeUndefined()
  })

  it('warns about an overpayment instead of quietly creating a refund', () => {
    renderDialog({
      ...purchase,
      installments: [
        { id: 'i1', principal: 570_000, interestPct: 0, amount: 570_000, dueDate: '2026-09-01T00:00:00.000Z', status: 'paid' },
      ],
    })
    fireEvent.change(volumeField(), { target: { value: '5000' } })
    expect(screen.getByText(/more has been paid than this delivery is worth/i)).toBeTruthy()
    expect(screen.getByText(/nothing left to adjust/i)).toBeTruthy()
  })

  it('shows the shortfall so it is noticed before saving', () => {
    renderDialog()
    fireEvent.change(volumeField(), { target: { value: '9650' } })
    expect(screen.getByText(/350 L short of the order/i)).toBeTruthy()
    // Variance readout in the footer, as a negative percentage.
    expect(screen.getByText(/-3\.5%/)).toBeTruthy()
  })

  it('shows an over-delivery as a positive variance', () => {
    renderDialog()
    fireEvent.change(volumeField(), { target: { value: '10200' } })
    expect(screen.getByText(/more than ordered/i)).toBeTruthy()
    expect(screen.getByText(/\+2\.0%/)).toBeTruthy()
  })

  it('reports no variance when the full order arrived', () => {
    renderDialog()
    expect(screen.getByText('None')).toBeTruthy()
  })

  it('refuses a blank volume rather than silently recording zero', async () => {
    // Number('') is 0 - finite and non-negative - so a naive validity check
    // would record "nothing arrived" and drain stock by the whole order.
    renderDialog()
    fireEvent.change(volumeField(), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: /mark received/i }))
    await waitFor(() => expect(screen.getByText(/enter the volume that actually arrived/i)).toBeTruthy())
    expect(repos.purchases.update).not.toHaveBeenCalled()
  })

  it('still allows a deliberate zero - a tanker that turned up empty', async () => {
    renderDialog()
    fireEvent.change(volumeField(), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: /mark received/i }))
    await waitFor(() => expect(repos.purchases.update).toHaveBeenCalled())
    const [, patch] = vi.mocked(repos.purchases.update).mock.calls[0]
    expect(patch.volumeReceived).toBe(0)
    // Nothing arrived, so nothing is owed.
    expect(patch.installments?.[0].principal).toBe(0)
  })

  it('surfaces the approval message instead of implying the receipt was posted', async () => {
    const message = 'Sent for approval. It will post to the System once an administrator approves it.'
    vi.spyOn(repos.purchases, 'update').mockResolvedValue({
      pending: true, approvalId: 'a1', summary: 'Edit to purchase', message,
    } as unknown as Purchase)
    const { onNotice } = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: /mark received/i }))
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith(message))
  })

  it('keeps the dialog open and explains itself when the save fails', async () => {
    vi.spyOn(repos.purchases, 'update').mockRejectedValue(new Error('Network is down.'))
    const { onClose } = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: /mark received/i }))
    await waitFor(() => expect(screen.getByText('Network is down.')).toBeTruthy())
    expect(onClose).not.toHaveBeenCalled()
  })
})
