// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ToastProvider } from '../../components/Toast'

const add = vi.fn(async (_d: Record<string, unknown>) => ({}))
const update = vi.fn(async (_id: string, _d: Record<string, unknown>) => ({}))
const remove = vi.fn(async (_id: string) => ({}))

const seat = (id: string, role: string, modules: string[], isAdmin = false) =>
  ({ id, name: id, username: id, role, modules, isAdmin, createdAt: '', updatedAt: '' })

vi.mock('../../lib/data', () => ({
  useTables: () => ({
    seats: [
      seat('admin', 'Owner', [], true),
      seat('d', 'Dispatcher', ['dashboard', 'logistics', 'inventory']),
      seat('r', 'Collector', ['collection']),
    ],
    dashboardConfigs: [
      { id: 'cfg1', createdAt: '', updatedAt: '', role: 'Dispatcher', widgets: ['kpis', 'deliveryBoard', 'stockByWarehouse'] },
      { id: 'cfg3', createdAt: '', updatedAt: '', role: 'Collector', widgets: [] },
    ],
  }),
}))
vi.mock('../../data/repo', () => ({
  repos: { dashboardConfigs: {
    add: (d: Record<string, unknown>) => add(d),
    update: (id: string, d: Record<string, unknown>) => update(id, d),
    remove: (id: string) => remove(id),
  } },
}))

import DashboardRoles from './DashboardRoles'

afterEach(() => { cleanup(); add.mockClear(); update.mockClear(); remove.mockClear() })

const view = () => render(<ToastProvider><DashboardRoles /></ToastProvider>)
const openRole = (role: string) => {
  view()
  fireEvent.click(screen.getByRole('button', { name: `Configure ${role}` }))
  return within(screen.getByRole('dialog'))
}

describe('Dashboard per role', () => {
  /** One row per role, with its state as a word rather than a sentence. */
  it('lists each role with its configuration state', () => {
    view()
    expect(screen.getByText('Default')).toBeTruthy()
    expect(screen.getByText('3 of 13 widgets')).toBeTruthy()
    expect(screen.getByText('Empty')).toBeTruthy()
  })

  /** Ticking a widget never grants access: a widget the role's seats cannot
   *  see is offered greyed with the module it needs, not as a working tick. */
  it('greys out widgets the role’s seats cannot see, naming the module', () => {
    const dlg = openRole('Dispatcher')
    const volume = dlg.getByRole('checkbox', { name: 'Volume sold' }) as HTMLInputElement
    expect(volume.disabled).toBe(true)
    expect(dlg.getAllByText('Needs Sales').length).toBeGreaterThan(0)
    expect((dlg.getByRole('checkbox', { name: 'Movements' }) as HTMLInputElement).disabled).toBe(false)
  })

  /** The drawing on the right is the point: what the dashboard will show. */
  it('draws the resulting dashboard and says which tabs vanish', () => {
    const dlg = openRole('Dispatcher')
    expect(dlg.getByText(/Cash flow, Activity have nothing to show/)).toBeTruthy()
    fireEvent.click(dlg.getByRole('checkbox', { name: 'Movements' }))
    fireEvent.click(dlg.getByRole('checkbox', { name: 'Depots' }))
    expect(dlg.getByText(/Operations, Cash flow, Activity have nothing to show/)).toBeTruthy()
  })

  it('reorders within a tab and saves the order with the widgets it offered', async () => {
    const dlg = openRole('Dispatcher')
    fireEvent.click(dlg.getByRole('button', { name: 'Move Depots up' }))
    fireEvent.click(dlg.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    const payload = update.mock.calls[0]?.[1] as { widgets: string[]; knownWidgets: string[] }
    expect(payload.widgets).toEqual(['kpis', 'stockByWarehouse', 'deliveryBoard'])
    expect(payload.knownWidgets.length).toBe(13)
  })

  /** Reset removes the config - the default view - rather than saving an
   *  empty one, which would mean "show nothing". */
  it('resets a configured role to the default by removing its config', async () => {
    const dlg = openRole('Collector')
    expect(dlg.getByText(/Nothing selected/)).toBeTruthy()
    fireEvent.click(dlg.getByRole('button', { name: 'Reset to default' }))
    await waitFor(() => expect(remove).toHaveBeenCalledWith('cfg3'))
  })

  it('creates a config for a role before its seats exist', async () => {
    view()
    fireEvent.click(screen.getByRole('button', { name: '+ Add role' }))
    const dlg = within(screen.getByRole('dialog'))
    fireEvent.change(dlg.getByLabelText('Role label'), { target: { value: 'Encoder' } })
    fireEvent.click(dlg.getByRole('button', { name: 'Continue' }))
    fireEvent.click(dlg.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(add).toHaveBeenCalledTimes(1))
    expect(add.mock.calls[0]?.[0]).toMatchObject({ role: 'Encoder' })
  })
})
