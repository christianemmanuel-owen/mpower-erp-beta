// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { Seat } from '../../data/types'

const add = vi.fn(async (_data: Record<string, unknown>) => ({}))
const update = vi.fn(async (_id: string, _data: Record<string, unknown>) => ({}))
const remove = vi.fn(async (_id: string) => ({}))
const updatePerson = vi.fn(async (_id: string, _data: Record<string, unknown>) => ({}))

const seats: Seat[] = [
  {
    id: 'seat-admin', createdAt: '', updatedAt: '', name: 'M. Reyes', username: 'admin',
    role: 'Owner', isAdmin: true, modules: [],
  },
  {
    id: 'seat-office', createdAt: '', updatedAt: '', name: 'C. Lim', username: 'c.lim',
    role: 'Office staff', isAdmin: false, modules: ['dashboard', 'sales'], scope: 'all',
  },
  {
    id: 'seat-crew', createdAt: '', updatedAt: '', name: 'R. Reyes', username: 'r.reyes',
    role: 'Pahinante', isAdmin: false, modules: ['logistics'], scope: 'own', personnelId: 'p-crew',
  },
]

vi.mock('../../lib/data', () => ({
  useTable: () => seats,
  useTables: () => ({
    personnel: [
      { id: 'p-crew', name: 'R. Reyes', role: 'pahinante', active: true },
      { id: 'p-driver', name: 'D. Santos', role: 'driver', active: true },
      { id: 'p-agent', name: 'A. Cruz', role: 'sales', active: true },
      { id: 'p-agent2', name: 'B. Lim', role: 'sales', active: true, agentId: 'ag-2' },
      { id: 'p-office', name: 'C. Lim', role: 'office', active: true },
    ],
    agents: [{ id: 'ag-1', name: 'A. Cruz' }, { id: 'ag-2', name: 'B. Lim' }],
  }),
}))
vi.mock('../../data/repo', () => ({
  repos: {
    seats: {
      add: (d: Record<string, unknown>) => add(d),
      update: (id: string, d: Record<string, unknown>) => update(id, d),
      remove: (id: string) => remove(id),
    },
    personnel: { update: (id: string, d: Record<string, unknown>) => updatePerson(id, d) },
  },
}))
vi.mock('../../lib/auth', async (original) => ({
  ...(await original<typeof import('../../lib/auth')>()),
  useAuth: () => ({ seat: seats[0], ready: true, login: async () => null, logout: () => {} }),
}))

import Seats from './Seats'

afterEach(() => {
  cleanup(); add.mockClear(); update.mockClear(); remove.mockClear(); updatePerson.mockClear()
})

const openNew = () => {
  render(<Seats />)
  fireEvent.click(screen.getByRole('button', { name: '+ Add seat' }))
  return within(screen.getByRole('dialog'))
}

describe('Seats', () => {
  /**
   * A crew login is three settings that have to agree: the logistics module,
   * scope 'own', and an employee link. Getting one wrong signed somebody in to
   * an empty app, and the old form asked for all three separately.
   */
  it('sets the machinery from the kind of seat chosen', () => {
    const form = openNew()
    fireEvent.click(form.getByRole('button', { name: /^Crew/ }))
    fireEvent.change(form.getByLabelText('Full name'), { target: { value: 'D. Santos' } })
    fireEvent.change(form.getByLabelText('Password'), { target: { value: 'river-anchor-42' } })
    fireEvent.change(form.getByLabelText('Employee'), { target: { value: 'p-driver' } })
    fireEvent.click(form.getByRole('button', { name: 'Create seat' }))

    expect(add).toHaveBeenCalledTimes(1)
    expect(add.mock.calls[0]?.[0]).toMatchObject({
      isAdmin: false, scope: 'own', modules: ['logistics'], personnelId: 'p-driver',
    })
  })

  /** One person cannot hold two seats - the server would then have two logins
   *  matching the same trips. */
  it('refuses a second seat for somebody who already has one', () => {
    const form = openNew()
    fireEvent.click(form.getByRole('button', { name: /^Crew/ }))
    fireEvent.change(form.getByLabelText('Full name'), { target: { value: 'R. Reyes' } })
    fireEvent.change(form.getByLabelText('Password'), { target: { value: 'river-anchor-42' } })
    fireEvent.change(form.getByLabelText('Employee'), { target: { value: 'p-crew' } })
    fireEvent.click(form.getByRole('button', { name: 'Create seat' }))

    expect(form.getByText(/is already linked to the seat for/)).toBeTruthy()
    expect(add).not.toHaveBeenCalled()
  })

  it('suggests a username from the name, stepping past one already taken', () => {
    const form = openNew()
    fireEvent.change(form.getByLabelText('Full name'), { target: { value: 'Ramon Bautista' } })
    expect((form.getByLabelText('Username') as HTMLInputElement).value).toBe('r.bautista')
    // r.reyes is the crew seat's, so the suggestion steps past it rather than
    // offering a username that will be refused on save.
    fireEvent.change(form.getByLabelText('Full name'), { target: { value: 'Ramon Reyes' } })
    expect((form.getByLabelText('Username') as HTMLInputElement).value).toBe('r.reyes2')
  })

  /** A field seat with nobody behind it matches no record at all. */
  it('will not create a field seat with no employee', () => {
    const form = openNew()
    fireEvent.click(form.getByRole('button', { name: /^Crew/ }))
    fireEvent.change(form.getByLabelText('Full name'), { target: { value: 'R. Reyes' } })
    fireEvent.change(form.getByLabelText('Password'), { target: { value: 'river-anchor-42' } })
    fireEvent.click(form.getByRole('button', { name: 'Create seat' }))

    expect(form.getByText(/must be linked to an employee/)).toBeTruthy()
    expect(add).not.toHaveBeenCalled()
  })

  /** Only the people who could hold it: a crew seat for the office manager is a
   *  seat that will never match a trip. */
  it('offers only the employees that kind of seat can be', () => {
    const form = openNew()
    fireEvent.click(form.getByRole('button', { name: /^Crew/ }))
    const picker = form.getByLabelText('Employee')
    expect(within(picker).getByText(/R\. Reyes/)).toBeTruthy()
    expect(within(picker).queryByText(/C\. Lim/)).toBeNull()

    fireEvent.click(form.getByRole('button', { name: /Sales agent/ }))
    expect(within(form.getByLabelText('Employee')).getByText(/A\. Cruz/)).toBeTruthy()
  })

  it('an office seat carries no employee link', () => {
    const form = openNew()
    fireEvent.click(form.getByRole('button', { name: /Office staff/ }))
    expect(form.queryByLabelText('This seat is')).toBeNull()
  })


  /**
   * The page is opened to answer "who can do what" - who approves, who is out
   * in the field. A flat list answers it only by reading every row.
   */
  it('groups the list by what a seat can do', () => {
    render(<Seats />)
    for (const [heading, count] of [['Administrators', '1'], ['Office staff', '1'], ['Field seats', '1']]) {
      // The heading is the uppercase group label; "Office staff" is also a
      // seat type shown on rows, so match the label element by its tag.
      const row = screen.getAllByText(heading).find((el) => el.tagName === 'P')!.parentElement
      expect(row).toBeTruthy()
      expect(within(row as HTMLElement).getByText(count)).toBeTruthy()
    }
    // A field seat is a person, so the row names which one.
    expect(screen.getAllByText('R. Reyes').length).toBeGreaterThan(1)
  })

  /**
   * A seat is four settings that only mean something together. Before this, the
   * only way to check a seat was to sign in as them.
   */
  it('draws the app the seat will get', () => {
    const form = openNew()
    // Office staff, one module: the rail is that module, and the landing screen
    // is tagged in the picture rather than described under it.
    const lands = () => form.getByText('Landing screen').parentElement as HTMLElement
    expect(lands().textContent).toMatch(/Home/)
    fireEvent.click(form.getByRole('button', { name: /^Crew/ }))
    expect(lands().textContent).toMatch(/My trips/)
  })

  it('says in the preview when a field seat has nobody behind it', () => {
    const form = openNew()
    fireEvent.click(form.getByRole('button', { name: /^Crew/ }))
    expect(form.getByText('No employee selected.')).toBeTruthy()
    fireEvent.change(form.getByLabelText('Employee'), { target: { value: 'p-crew' } })
    expect(form.queryByText('No employee selected.')).toBeNull()
    // Named, the preview says whose records the seat will match.
    expect(form.getByText(/Trips they are assigned to, as R\. Reyes\./)).toBeTruthy()
  })


  /**
   * The dead end this closes: a sales seat was saveable with an employee who had
   * no Agent record behind them. `Sale.agentId` points at an Agent, a login
   * points at Personnel, and `Personnel.agentId` is the only bridge - so that
   * seat signed in to a screen where every sale it filed came back "not yours"
   * from the server, with nothing anywhere saying why.
   */
  it('will not create a sales seat whose employee sells under no agent', async () => {
    const form = openNew()
    fireEvent.click(form.getByRole('button', { name: /Sales agent/ }))
    fireEvent.change(form.getByLabelText('Full name'), { target: { value: 'A. Cruz' } })
    fireEvent.change(form.getByLabelText('Password'), { target: { value: 'river-anchor-42' } })
    fireEvent.change(form.getByLabelText('Employee'), { target: { value: 'p-agent' } })
    fireEvent.click(form.getByRole('button', { name: 'Create seat' }))

    expect(form.getByText(/sells under/)).toBeTruthy()
    expect(add).not.toHaveBeenCalled()
  })

  /** And the fix is on the form rather than a trip to HR. */
  it('links the employee to the agent chosen here', async () => {
    const form = openNew()
    fireEvent.click(form.getByRole('button', { name: /Sales agent/ }))
    fireEvent.change(form.getByLabelText('Full name'), { target: { value: 'A. Cruz' } })
    fireEvent.change(form.getByLabelText('Password'), { target: { value: 'river-anchor-42' } })
    fireEvent.change(form.getByLabelText('Employee'), { target: { value: 'p-agent' } })
    fireEvent.change(form.getByLabelText('Sales agent record'), { target: { value: 'ag-1' } })
    fireEvent.click(form.getByRole('button', { name: 'Create seat' }))

    await waitFor(() => expect(add).toHaveBeenCalledTimes(1))
    expect(updatePerson).toHaveBeenCalledWith('p-agent', { agentId: 'ag-1' })
  })

  /** An employee HR already linked needs no second answer. */
  it('carries over the agent the employee already sells under', () => {
    const form = openNew()
    fireEvent.click(form.getByRole('button', { name: /Sales agent/ }))
    fireEvent.change(form.getByLabelText('Employee'), { target: { value: 'p-agent2' } })
    expect((form.getByLabelText('Sales agent record') as HTMLSelectElement).value).toBe('ag-2')
  })

  /** The role label follows the seat type until somebody types their own. It
   *  used to stick to the first type chosen, so Crew → Sales agent read "Crew". */
  it('keeps the role label in step with the seat type', () => {
    const form = openNew()
    fireEvent.click(form.getByRole('button', { name: /^Crew/ }))
    expect((form.getByLabelText('Role label') as HTMLInputElement).value).toBe('Crew')
    fireEvent.click(form.getByRole('button', { name: /Sales agent/ }))
    expect((form.getByLabelText('Role label') as HTMLInputElement).value).toBe('Sales agent')
    fireEvent.change(form.getByLabelText('Role label'), { target: { value: 'Senior agent' } })
    fireEvent.click(form.getByRole('button', { name: /^Crew/ }))
    expect((form.getByLabelText('Role label') as HTMLInputElement).value).toBe('Senior agent')
  })

  /** A field seat is the employee, so choosing them fills in the name. */
  it('fills the name and username from the employee chosen', () => {
    const form = openNew()
    fireEvent.click(form.getByRole('button', { name: /^Crew/ }))
    fireEvent.change(form.getByLabelText('Employee'), { target: { value: 'p-driver' } })
    expect((form.getByLabelText('Full name') as HTMLInputElement).value).toBe('D. Santos')
    expect((form.getByLabelText('Username') as HTMLInputElement).value).toBe('d.santos')
  })

  /** A sales seat with no agent behind it looks like every other row otherwise. */
  it('flags a sales seat whose employee sells under no agent', () => {
    seats.push({
      id: 'seat-agent', createdAt: '', updatedAt: '', name: 'A. Cruz', username: 'a.cruz',
      role: 'Sales agent', isAdmin: false, modules: ['sales'], scope: 'own', personnelId: 'p-agent',
    })
    try {
      render(<Seats />)
      expect(screen.getByText('Agent not linked')).toBeTruthy()
    } finally {
      seats.pop()
    }
  })

  it('confirms before deleting a seat', () => {
    render(<Seats />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete C. Lim' }))
    expect(screen.getByText('Delete C. Lim’s seat?')).toBeTruthy()
    expect(remove).not.toHaveBeenCalled()
  })

  /** Refusing after the click was a dead end; the control is simply absent. */
  it('offers no delete for the seat you are signed in with', () => {
    render(<Seats />)
    expect(screen.queryByRole('button', { name: 'Delete M. Reyes' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Edit M. Reyes' })).toBeTruthy()
  })
})
