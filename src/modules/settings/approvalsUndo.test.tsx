// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '../../components/Toast'
import { queryClient } from '../../lib/queryClient'

/**
 * Undoing a decision from the queue: who sees the control, and that the
 * confirmation reaches the server with the reason typed.
 */
const decided = {
  id: 'ap1', tbl: 'sales', recordId: 'sale-1', action: 'create', status: 'approved',
  payload: {}, summary: 'New sale - 20,000 L @ ₱42/L',
  requestedBy: 'seat-staff', requestedByName: 'Rey Mendoza', requestedAt: '2026-09-01T00:00:00.000Z',
  decidedBy: 'seat-other', decidedByName: 'Other Approver', decidedAt: '2026-09-02T00:00:00.000Z', decisionNote: null,
}
let me = { id: 'seat-admin', name: 'Admin', isAdmin: true, canApprove: false, modules: ['settings'] }
vi.mock('../../lib/auth', async (original) => ({
  ...(await original<typeof import('../../lib/auth')>()),
  useAuth: () => ({ seat: me, ready: true, login: async () => null, logout: () => {} }),
}))
const reverse = vi.fn(async (_vars?: unknown) => ({ ok: true, status: 'pending' }))
vi.mock('../../lib/approvals', async (original) => ({
  ...(await original<typeof import('../../lib/approvals')>()),
  useApprovals: () => ({ data: { rows: [decided], pendingCount: 0 }, isLoading: false }),
  useApprovalRules: () => ({ data: { rules: { tables: ['sales'] }, approvable: ['sales'], defaults: ['sales'] } }),
  useReverseApproval: () => ({ isPending: false, mutate: (vars: unknown, opts?: { onSuccess?: () => void }) => { reverse(vars); opts?.onSuccess?.() } }),
}))
vi.mock('../../lib/data', () => ({ useTable: () => [], useTables: () => ({}) }))

import Approvals from './Approvals'

const view = () => render(
  <QueryClientProvider client={queryClient}><ToastProvider><MemoryRouter><Approvals /></MemoryRouter></ToastProvider></QueryClientProvider>,
)
afterEach(() => { cleanup(); reverse.mockClear() })

describe('undoing an approval from the queue', () => {
  it('offers Undo to an admin on a decided row and sends the reason', async () => {
    view()
    fireEvent.click(screen.getByRole('button', { name: 'approved' }))
    fireEvent.click(screen.getByRole('button', { name: 'Undo approval' }))
    fireEvent.change(screen.getByPlaceholderText(/Approved the wrong line/), { target: { value: 'Wrong line' } })
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(reverse).toHaveBeenCalledWith({ id: 'ap1', note: 'Wrong line', tbl: 'sales' }))
  })

  it('hides Undo from an approver who did not make the decision', () => {
    me = { ...me, id: 'seat-third', isAdmin: false, canApprove: true }
    view()
    fireEvent.click(screen.getByRole('button', { name: 'approved' }))
    expect(screen.queryByRole('button', { name: 'Undo approval' })).toBeNull()
  })
})
