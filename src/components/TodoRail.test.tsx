// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import TodoRail from './TodoRail'
import { repos } from '../data/repo'
import type { Todo } from '../data/types'

/**
 * The rail groups by due date, so the date has to be reachable and changeable.
 * The first version offered three shortcuts and nothing else: two of its own
 * buckets could not be filled, and an item's date was fixed at creation.
 */

const TODAY = '2026-08-25'
const todo = (over: Partial<Todo>): Todo => ({
  id: 't1', seatId: 'seat1', text: 'Chase Acme PO', done: false,
  createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z', ...over,
} as Todo)

let TODOS: Todo[] = []
const SEATS = [
  { id: 'seat1', name: 'Ramon', role: 'Encoder' },
  { id: 'seat2', name: 'Dina Cruz', role: 'Dispatcher' },
]

let ME: Record<string, unknown> = { id: 'seat1', name: 'Ramon', isAdmin: false, modules: ['inventory'] }
vi.mock('../lib/auth', () => ({
  useAuth: () => ({ seat: ME }),
}))
vi.mock('../lib/deepLink', () => ({ recordHref: () => null }))
vi.mock('../lib/data', () => ({
  useTables: (keys: readonly string[]) =>
    Object.fromEntries(keys.map((k) => [k, k === 'todos' ? TODOS : k === 'seats' ? SEATS : []])),
}))
vi.mock('../data/repo', () => ({
  repos: { todos: { add: vi.fn(), update: vi.fn(), remove: vi.fn() } },
}))

beforeEach(() => {
  vi.setSystemTime(new Date(`${TODAY}T09:00:00.000Z`))
  vi.clearAllMocks()
  TODOS = []
  ME = { id: 'seat1', name: 'Ramon', isAdmin: false, modules: ['inventory'] }
})
afterEach(() => { cleanup(); vi.useRealTimers() })

const renderRail = () => render(<MemoryRouter><TodoRail /></MemoryRouter>)
/** Adding is behind a dialog now, matching the announcement board. */
const openCompose = () => fireEvent.click(screen.getByLabelText(/new to-do/i))
const addField = () => screen.getByPlaceholderText(/what needs doing/i)
const newDateField = () => screen.getByLabelText(/due date for the new to-do/i) as HTMLInputElement

describe('TodoRail dates', () => {
  /** The quick bar adds a plain item on Enter; the full form is behind the expand. */
  it('adds a plain item from the composer bar on Enter', () => {
    renderRail()
    expect(screen.queryByPlaceholderText(/what needs doing/i)).toBeNull()
    const bar = screen.getByLabelText('Add a to-do')
    fireEvent.change(bar, { target: { value: 'Ring the depot' } })
    fireEvent.keyDown(bar, { key: 'Enter' })
    expect(repos.todos.add).toHaveBeenCalledWith(expect.objectContaining({ text: 'Ring the depot', seatId: 'seat1' }))
    openCompose()
    expect(screen.getByPlaceholderText(/what needs doing/i)).toBeTruthy()
  })

  it('files a new item against any date, not just the shortcuts', () => {
    renderRail()
    openCompose()
    fireEvent.change(addField(), { target: { value: 'Renew depot permit' } })
    fireEvent.change(newDateField(), { target: { value: '2026-11-14' } })
    fireEvent.click(screen.getByRole('button', { name: /add to my list/i }))
    expect(repos.todos.add).toHaveBeenCalledWith(expect.objectContaining({
      text: 'Renew depot permit',
      dueDate: new Date('2026-11-14').toISOString(),
    }))
  })

  it('adds with no date when the field is left empty', () => {
    renderRail()
    openCompose()
    fireEvent.change(addField(), { target: { value: 'Ring the supplier' } })
    fireEvent.click(screen.getByRole('button', { name: /add to my list/i }))
    const payload = vi.mocked(repos.todos.add).mock.calls[0][0]
    expect(payload).not.toHaveProperty('dueDate')
  })

  it('shortcuts fill the date field rather than bypassing it', () => {
    renderRail()
    openCompose()
    fireEvent.click(screen.getByRole('button', { name: 'Tomorrow' }))
    expect(newDateField().value).toBe('2026-08-26')
    fireEvent.click(screen.getByRole('button', { name: 'No date' }))
    expect(newDateField().value).toBe('')
  })

  it('changes the date on an item that already exists', () => {
    TODOS = [todo({ dueDate: '2026-08-25T00:00:00.000Z' })]
    renderRail()
    fireEvent.click(screen.getByLabelText(/change due date/i))
    fireEvent.change(screen.getByLabelText(/due date for "Chase Acme PO"/i), { target: { value: '2026-09-02' } })
    expect(repos.todos.update).toHaveBeenCalledWith('t1', { dueDate: new Date('2026-09-02').toISOString() })
  })

  it('clears a date with a value the server merge can actually apply', () => {
    TODOS = [todo({ dueDate: '2026-08-25T00:00:00.000Z' })]
    renderRail()
    fireEvent.click(screen.getByLabelText(/change due date/i))
    fireEvent.change(screen.getByLabelText(/due date for "Chase Acme PO"/i), { target: { value: '' } })
    // Not undefined: JSON.stringify drops undefined keys and the server's PUT
    // is a merge, so an undefined here clears nothing and the date returns.
    expect(repos.todos.update).toHaveBeenCalledWith('t1', { dueDate: '' })
  })

  it('offers a date on an item that has none', () => {
    TODOS = [todo({})]
    renderRail()
    expect(screen.getByRole('button', { name: /add a due date/i })).toBeTruthy()
  })

  it('groups by when it is due, and flags what is late', () => {
    TODOS = [
      todo({ id: 'a', text: 'Late one', dueDate: '2026-08-20T00:00:00.000Z' }),
      todo({ id: 'b', text: 'Due today', dueDate: `${TODAY}T00:00:00.000Z` }),
      todo({ id: 'c', text: 'Someday', dueDate: undefined }),
    ]
    renderRail()
    expect(screen.getByText(/Overdue · 1/)).toBeTruthy()
    expect(screen.getByText(/Today · 1/)).toBeTruthy()
    expect(screen.getByText(/No date · 1/)).toBeTruthy()
  })

  /**
   * Assignment is for administrators and approvers only; everyone else keeps
   * a private list with no picker at all.
   */
  it('offers an assignee picker only to seats that may assign', () => {
    renderRail()
    openCompose()
    expect(screen.queryByLabelText('For')).toBeNull()
    cleanup()
    ME = { ...ME, canApprove: true }
    renderRail()
    openCompose()
    fireEvent.click(screen.getByRole('radio', { name: /Dina Cruz/ }))
    fireEvent.change(addField(), { target: { value: 'Book the Bulacan run' } })
    fireEvent.click(screen.getByRole('button', { name: 'Assign to Dina Cruz' }))
    expect(repos.todos.add).toHaveBeenCalledWith(expect.objectContaining({ seatId: 'seat2', text: 'Book the Bulacan run' }))
  })

  /** An item on my list from a manager says so; one I put on theirs sits apart. */
  it('shows who assigned an item, and lists what I assigned to others', () => {
    TODOS = [
      todo({ id: 'a', text: 'Call Cielo', assignedById: 'seat2', assignedByName: 'Dina Cruz' }),
      todo({ id: 'b', seatId: 'seat2', text: 'Weigh the tankers', assignedById: 'seat1', assignedByName: 'Ramon' }),
    ]
    renderRail()
    expect(screen.getByText('from Dina Cruz')).toBeTruthy()
    expect(screen.getByText(/Assigned to others · 1 open/)).toBeTruthy()
    expect(screen.getByText('for Dina Cruz')).toBeTruthy()
  })

  /** An item can be reworded and re-dated after the fact, in the same dialog
   *  that made it - with "For" absent, since the server will not move it. */
  it('edits an item’s words and date in place', async () => {
    ME = { id: 'seat1', name: 'Ramon', isAdmin: true, modules: ['inventory'] }
    TODOS = [todo({ id: 'a', text: 'Call Cielo', dueDate: '2026-08-25T00:00:00.000Z' })]
    renderRail()
    fireEvent.click(screen.getByRole('button', { name: 'Edit "Call Cielo"' }))
    expect(screen.getByRole('dialog', { name: 'Edit to-do' })).toBeTruthy()
    expect(screen.queryByRole('radiogroup', { name: 'For' })).toBeNull()
    const field = screen.getByLabelText('What needs doing') as HTMLInputElement
    expect(field.value).toBe('Call Cielo')
    fireEvent.change(field, { target: { value: 'Call Cielo about the PO' } })
    fireEvent.click(screen.getByRole('button', { name: 'Tomorrow' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(repos.todos.update).toHaveBeenCalledWith('a', { text: 'Call Cielo about the PO', dueDate: new Date('2026-08-26').toISOString() }))
    expect(repos.todos.add).not.toHaveBeenCalled()
  })
})
