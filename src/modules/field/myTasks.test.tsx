// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ToastProvider } from '../../components/Toast'
import { todayISO } from '../../lib/format'
import type { Todo } from '../../data/types'

const day = (offset: number) => todayISO(new Date(Date.now() + offset * 86_400_000))
const todo = (over: Partial<Todo> = {}): Todo => ({
  id: 't1', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '', seatId: 'seat-crew', text: 'Weigh the two tankers', done: false, ...over,
})

let todos: Todo[] = []
const add = vi.fn(async (_d: Record<string, unknown>) => ({}))
const update = vi.fn(async (_id: string, _d: Record<string, unknown>) => ({}))

vi.mock('../../lib/data', () => ({ useTable: () => todos }))
vi.mock('../../data/repo', () => ({
  repos: { todos: { add: (d: Record<string, unknown>) => add(d), update: (id: string, d: Record<string, unknown>) => update(id, d) } },
}))
vi.mock('../../lib/auth', async (original) => ({
  ...(await original<typeof import('../../lib/auth')>()),
  useAuth: () => ({
    seat: { id: 'seat-crew', name: 'Dennis Santos', scope: 'own' },
    ready: true, login: async () => null, logout: () => {},
  }),
}))

import MyTasks, { openTaskCount } from './MyTasks'

afterEach(() => { cleanup(); add.mockClear(); update.mockClear(); todos = [] })

const view = () => render(
  <MemoryRouter><ToastProvider><MyTasks /></ToastProvider></MemoryRouter>,
)

describe('My tasks', () => {
  it('groups open items by when they are due, overdue first', () => {
    todos = [
      todo({ id: 'a', text: 'Later thing', dueDate: day(5) }),
      todo({ id: 'b', text: 'Chase the balance', dueDate: day(-3) }),
      todo({ id: 'c', text: 'Confirm delivery slot', dueDate: day(0) }),
      todo({ id: 'd', text: 'No date thing' }),
    ]
    view()
    const labels = screen.getAllByText(/^(Overdue|Today|Tomorrow|Later|No date) · \d+$/).map((n) => n.textContent)
    expect(labels).toEqual(['Overdue · 1', 'Today · 1', 'Later · 1', 'No date · 1'])
  })

  it('shows who put an item on the list, and a way into the record it is about', () => {
    todos = [todo({ text: 'Weigh the two tankers', assignedById: 'seat-admin', assignedByName: 'Dina Cruz', tbl: 'deliveries', recordId: 'd1' })]
    view()
    expect(screen.getByText('from Dina Cruz')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Trip/ }).getAttribute('href')).toContain('d1')
  })

  it('ticks an item done and keeps done ones out of the way until asked', () => {
    todos = [todo({ id: 'a', text: 'Open one' }), todo({ id: 'b', text: 'Finished one', done: true })]
    view()
    expect(screen.queryByText('Finished one')).toBeNull()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Mark "Open one" done' }))
    expect(update).toHaveBeenCalledWith('a', { done: true })

    fireEvent.click(screen.getByRole('button', { name: 'Show done · 1' }))
    expect(screen.getByText('Finished one')).toBeTruthy()
  })

  /** With motion on, a tick is seen to land before the row goes: the write is
   *  held for the fold, and the row stays shown done until the table agrees. */
  it('holds a ticked row in place, folds it, then writes', () => {
    vi.useFakeTimers()
    const mm = window.matchMedia
    window.matchMedia = (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as never
    try {
      todos = [todo({ id: 'a', text: 'Open one' })]
      const { rerender } = view()
      const box = () => screen.getByRole('checkbox', { name: /Open one/ }) as HTMLInputElement
      fireEvent.click(box())
      expect(box().checked).toBe(true)
      expect(update).not.toHaveBeenCalled()
      act(() => { vi.advanceTimersByTime(600) })
      expect(box().closest('.task-row')!.classList.contains('is-leaving')).toBe(true)
      expect(update).not.toHaveBeenCalled()
      act(() => { vi.advanceTimersByTime(200) })
      expect(update).toHaveBeenCalledWith('a', { done: true })

      // Until the table shows it done, the row is still held: no spring-back.
      expect(box().checked).toBe(true)
      todos = [todo({ id: 'a', text: 'Open one', done: true })]
      rerender(<MemoryRouter><ToastProvider><MyTasks /></ToastProvider></MemoryRouter>)
      expect(screen.queryByRole('checkbox', { name: /Open one/ })).toBeNull()
    } finally {
      window.matchMedia = mm
      vi.useRealTimers()
    }
  })

  it('adds from the button, in a sheet, with Enter', async () => {
    view()
    fireEvent.click(screen.getByRole('button', { name: 'Add a task' }))
    const input = screen.getByLabelText('Task')
    fireEvent.change(input, { target: { value: '  Refuel at Valenzuela ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(add).toHaveBeenCalledWith({ seatId: 'seat-crew', text: 'Refuel at Valenzuela', done: false })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add a task' })).toBeNull())
  })

  it('only ever shows this seat’s list', () => {
    todos = [todo({ id: 'a', text: 'Mine' }), todo({ id: 'b', text: 'Somebody else’s', seatId: 'seat-other' })]
    view()
    expect(screen.getByText('Mine')).toBeTruthy()
    expect(screen.queryByText('Somebody else’s')).toBeNull()
    const strip = screen.getByText('Open').parentElement!
    expect(within(strip).getByText('1')).toBeTruthy()
  })

  it('counts open items for the badge, ignoring other seats and done ones', () => {
    const rows = [todo({ id: 'a' }), todo({ id: 'b', done: true }), todo({ id: 'c', seatId: 'seat-other' })]
    expect(openTaskCount(rows, 'seat-crew')).toBe(1)
    expect(openTaskCount(undefined, 'seat-crew')).toBe(0)
  })

  it('edits an item from its pencil, in the same sheet', async () => {
    todos = [todo({ id: 'a', text: 'Weigh the two tankers', dueDate: day(0) })]
    view()
    fireEvent.click(screen.getByRole('button', { name: 'Edit "Weigh the two tankers"' }))
    expect(screen.getByRole('dialog', { name: 'Edit task' })).toBeTruthy()
    const field = screen.getByLabelText('Task') as HTMLInputElement
    expect(field.value).toBe('Weigh the two tankers')
    expect(screen.getByRole('button', { name: 'Today', pressed: true })).toBeTruthy()
    fireEvent.change(field, { target: { value: 'Weigh all three tankers' } })
    fireEvent.click(screen.getByRole('button', { name: 'No date' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(update).toHaveBeenCalledWith('a', { text: 'Weigh all three tankers', dueDate: '' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    // The tick was not toggled by the tap on the pencil.
    expect(update).toHaveBeenCalledTimes(1)
  })
})
