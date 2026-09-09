// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const safeDelete = vi.fn(async () => ({ ok: false, reason: 'Two purchases still point at this supplier.' }))
vi.mock('../../data/repo', () => ({
  repos: {
    suppliers: { add: vi.fn(), update: vi.fn() },
    warehouses: {}, agents: {}, customers: {}, bankAccounts: {}, trucks: {},
  },
  safeDeleteLookup: (...a: unknown[]) => safeDelete(...(a as [])),
}))
vi.mock('../../data/seed', () => ({ resetDemoData: vi.fn() }))
vi.mock('../../lib/data', () => ({
  useTables: () => ({
    suppliers: [{ id: 'sup1', name: 'Seaoil', contactPerson: 'R. Cruz', contactNumber: '0917', paymentTermDays: 30 }],
    warehouses: [], agents: [], customers: [], bankAccounts: [], trucks: [], seats: [],
  }),
}))
vi.mock('../../lib/auth', async (original) => ({
  ...(await original<typeof import('../../lib/auth')>()),
  useAuth: () => ({ seat: { id: 's1', name: 'Admin', isAdmin: false, modules: ['settings'] }, ready: true, login: async () => null, logout: () => {} }),
}))

import Settings from './Settings'

afterEach(() => { cleanup(); safeDelete.mockClear() })

const view = () => render(<MemoryRouter><Settings /></MemoryRouter>)

describe('Admin settings', () => {
  /** Delete went through on a single click of a red text link, and the only
   *  feedback was a red box on the page if the record turned out to be in use. */
  it('confirms before deleting a reference record', async () => {
    view()
    fireEvent.click(screen.getByRole('button', { name: 'Delete Seaoil' }))
    expect(safeDelete).not.toHaveBeenCalled()

    const dialog = within(screen.getByRole('dialog'))
    expect(screen.getByText('Delete Seaoil?')).toBeTruthy()
    fireEvent.click(dialog.getByRole('button', { name: 'Delete' }))
    expect(safeDelete).toHaveBeenCalledWith('suppliers', 'sup1')
  })

  /** "Reset demo data" replaces every record in the system; it used to be a
   *  browser confirm behind a white outline button on a black promo card. */
  it('confirms before replacing everything with demo data', () => {
    view()
    fireEvent.click(screen.getByRole('button', { name: 'Reset demo data' }))
    expect(screen.getByText('Replace everything with the demo dataset?')).toBeTruthy()
  })

  /** The title used to name the list - "Edit - Suppliers" - which says what you
   *  are looking at only if you already know. */
  it('names the record in the dialog title, not the list', () => {
    view()
    fireEvent.click(screen.getByRole('button', { name: 'Edit Seaoil' }))
    expect(within(screen.getByRole('dialog')).getByText('Seaoil')).toBeTruthy()

    cleanup()
    view()
    fireEvent.click(screen.getByRole('button', { name: '+ Add supplier' }))
    expect(within(screen.getByRole('dialog')).getByText('New supplier')).toBeTruthy()
  })
})
