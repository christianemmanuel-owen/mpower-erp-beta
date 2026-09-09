import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckSquare, ChevronsRight, Plus, X } from 'lucide-react'
import { Field, GhostButton, Input, PrimaryButton, Dialog } from './ui'
import { useTables } from '../lib/data'
import { useAuth } from '../lib/auth'
import { resolveWidgets } from '../lib/dashboardConfig'
import { repos } from '../data/repo'
import { recordHref } from '../lib/deepLink'
import { fmtDate } from '../lib/format'
import type { Todo } from '../data/types'

/**
 * The seat's own to-do list, as a collapsible rail beside every screen.
 *
 * It used to be a card on the dashboard. That wasted the feature it was built
 * around: a to-do can carry a deep link to the record it is about (`tbl` +
 * `recordId`), so "chase Acme PO" opens the sale. A link like that only pays off
 * if the list is visible *while you work somewhere else* - on the dashboard you
 * had to leave the list to follow it, then navigate back to see the next item.
 * As a rail it stays open across Sales, Stock and Trips, so the list and the
 * record it points at are on screen together.
 *
 * "Per user" is still the whole specification and still load-bearing: these are
 * private notes, not assigned tasks. The server scopes `todos` to the owning
 * seat (see OWN_SEAT_TABLES in the API route), so a manager genuinely cannot
 * read what an encoder wrote to themselves - admins included. The filter below
 * is belt-and-braces, not the guarantee; it used to be the only thing standing
 * between a private note and anyone who opened devtools.
 */

const RAIL_OPEN_KEY = 'mpower.todoRail.open'

type Bucket = 'overdue' | 'today' | 'tomorrow' | 'later' | 'none'

const BUCKET_ORDER: Bucket[] = ['overdue', 'today', 'tomorrow', 'later', 'none']

const BUCKET_LABEL: Record<Bucket, string> = {
  overdue: 'Overdue',
  today: 'Today',
  tomorrow: 'Tomorrow',
  later: 'Later',
  none: 'No date',
}

const dayString = (offsetDays = 0) =>
  new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10)

function bucketOf(t: Todo, today: string, tomorrow: string): Bucket {
  if (!t.dueDate) return 'none'
  const d = t.dueDate.slice(0, 10)
  if (d < today) return 'overdue'
  if (d === today) return 'today'
  if (d === tomorrow) return 'tomorrow'
  return 'later'
}

/**
 * Shortcuts that fill the date field, rather than replacing it.
 *
 * The first version offered only these, which left the buckets above
 * unreachable: you could file something for today, tomorrow or a week out and
 * nothing else, and once an item existed its date was fixed forever. They are
 * still worth having because they cover most of what anyone types, but they now
 * set the field instead of being the only way into it.
 */
const DUE_SHORTCUTS: { label: string; offset: number }[] = [
  { label: 'Today', offset: 0 },
  { label: 'Tomorrow', offset: 1 },
  { label: 'Next week', offset: 7 },
]

const dateInputCls =
  'box-border w-full rounded-[6px] border border-inputline bg-white px-[7px] py-[4px] font-meta text-[12px] font-[inherit] text-ink focus:border-teal focus:outline-none'

function TodoRow({ todo, today }: { todo: Todo; today: string }) {
  const href = todo.tbl && todo.recordId ? recordHref(todo.tbl, todo.recordId) : null
  const overdue = !todo.done && todo.dueDate && todo.dueDate.slice(0, 10) < today
  // Editing the date in place. Without this an item's date was fixed at
  // creation and the only way to move it was to delete and retype it.
  const [editingDate, setEditingDate] = useState(false)

  // Clearing sends '' rather than undefined. Update is a merge server-side
  // ({...existing, ...body}) and JSON.stringify drops undefined keys, so an
  // `undefined` here reached the server as no key at all and the old date
  // survived: blanking the field looked like it worked and then the date came
  // straight back on the next fetch. '' round-trips and reads as falsy at every
  // point that asks about dueDate.
  function setDue(value: string) {
    repos.todos.update(todo.id, { dueDate: value ? new Date(value).toISOString() : '' })
    setEditingDate(false)
  }

  return (
    <div className="group flex items-start gap-2 px-3 py-[7px] transition-colors hover:bg-fill2">
      <input
        type="checkbox"
        checked={todo.done}
        onChange={() => repos.todos.update(todo.id, { done: !todo.done })}
        aria-label={todo.done ? `Mark "${todo.text}" not done` : `Mark "${todo.text}" done`}
        className="mt-[3px] cursor-pointer accent-teal"
      />
      <span className="min-w-0 flex-1">
        <span className={`block text-[13px] leading-[1.4] ${todo.done ? 'text-faint line-through' : 'text-ink'}`}>
          {todo.text}
        </span>
        <span className="mt-[2px] flex flex-wrap items-center gap-x-2 font-meta text-[12px]">
          {editingDate ? (
            <input
              type="date"
              autoFocus
              defaultValue={todo.dueDate?.slice(0, 10) ?? ''}
              onChange={(e) => setDue(e.target.value)}
              onBlur={() => setEditingDate(false)}
              aria-label={`Due date for "${todo.text}"`}
              className={dateInputCls}
            />
          ) : (
            <button
              type="button"
              onClick={() => setEditingDate(true)}
              aria-label={todo.dueDate ? `Change due date, currently ${fmtDate(todo.dueDate)}` : 'Add a due date'}
              className={`cursor-pointer border-0 bg-transparent p-0 hover:underline ${
                overdue ? 'font-semibold text-redtext' : todo.dueDate ? 'text-faint' : 'text-transparent group-hover:text-faint'
              }`}
            >
              {todo.dueDate ? fmtDate(todo.dueDate) : 'Set a date'}
            </button>
          )}
          {href && (
            <Link to={href} className="truncate text-teal hover:underline">
              Open {todo.tbl?.replace(/s$/, '')}
            </Link>
          )}
        </span>
      </span>
      <button
        type="button"
        onClick={() => repos.todos.remove(todo.id)}
        aria-label={`Delete "${todo.text}"`}
        className="mt-[2px] cursor-pointer border-0 bg-transparent p-0 text-transparent group-hover:text-faint hover:!text-redtext"
      >
        <X size={13} strokeWidth={2} />
      </button>
    </div>
  )
}

export default function TodoRail() {
  const { seat } = useAuth()
  const data = useTables(['todos', 'dashboardConfigs'] as const)

  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(RAIL_OPEN_KEY) !== '0'
    } catch {
      return true
    }
  })
  const [text, setText] = useState('')
  const [due, setDue] = useState('')
  const [busy, setBusy] = useState(false)
  const [showDone, setShowDone] = useState(false)
  const [composing, setComposing] = useState(false)

  useEffect(() => {
    try {
      localStorage.setItem(RAIL_OPEN_KEY, open ? '1' : '0')
    } catch {
      // A browser with site data blocked still gets a working rail, just not a
      // remembered one.
    }
  }, [open])

  const today = dayString(0)
  const tomorrow = dayString(1)

  const mine = useMemo(() => {
    if (!data || !seat) return []
    return data.todos
      .filter((t) => t.seatId === seat.id)
      .sort((a, b) => {
        const ad = a.dueDate ?? '9999'
        const bd = b.dueDate ?? '9999'
        if (ad !== bd) return ad.localeCompare(bd)
        return b.createdAt.localeCompare(a.createdAt)
      })
  }, [data, seat])

  // The rail is still governed by the `todos` widget key, so a role that does
  // not want it can untick it on the Dashboard roles screen exactly as before.
  const enabled = !!data && !!seat && resolveWidgets(seat, data.dashboardConfigs).includes('todos')

  // The rail is fixed-position, so it can't push the page itself. It publishes
  // its own width instead and the Shell reserves that much room - which keeps
  // the collapse animation a single source of truth rather than two components
  // agreeing on a number.
  useEffect(() => {
    const width = !enabled ? '0px' : open ? '280px' : '44px'
    document.documentElement.style.setProperty('--todo-rail-w', width)
    return () => document.documentElement.style.setProperty('--todo-rail-w', '0px')
  }, [enabled, open])

  if (!enabled || !data || !seat) return null

  const openItems = mine.filter((t) => !t.done)
  const doneItems = mine.filter((t) => t.done)
  const overdueCount = openItems.filter((t) => bucketOf(t, today, tomorrow) === 'overdue').length

  const grouped = BUCKET_ORDER
    .map((b) => ({ bucket: b, items: openItems.filter((t) => bucketOf(t, today, tomorrow) === b) }))
    .filter((g) => g.items.length > 0)

  async function add() {
    const value = text.trim()
    if (!value || !seat) return
    setBusy(true)
    try {
      await repos.todos.add({
        seatId: seat.id,
        text: value,
        done: false,
        ...(due ? { dueDate: new Date(due).toISOString() } : {}),
      })
      setText('')
      setDue('')
      setComposing(false)
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <aside className="fixed inset-y-0 right-0 z-[1000] flex w-[44px] flex-col items-center border-l border-line bg-sidebar pt-[14px]">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`Open to-do list, ${openItems.length} open`}
          className="relative flex h-[30px] w-[30px] cursor-pointer items-center justify-center rounded-[6px] border-0 bg-transparent text-sec transition-colors hover:bg-hovrow hover:text-ink"
        >
          <CheckSquare size={16} strokeWidth={1.8} />
          {openItems.length > 0 && (
            <span
              className={`absolute -right-[2px] -top-[2px] flex h-[15px] min-w-[15px] items-center justify-center rounded-full px-[3px] font-meta text-[10px] font-semibold ${
                overdueCount > 0 ? 'bg-redbadge text-redtext' : 'bg-fill2 text-sec'
              }`}
            >
              {openItems.length}
            </span>
          )}
        </button>
      </aside>
    )
  }

  return (
    <aside className="fixed inset-y-0 right-0 z-[1000] flex w-[280px] flex-col border-l border-line bg-sidebar">
      <div className="flex items-center gap-2 border-b border-line px-3 py-[10px]">
        <span className="text-[13px] font-semibold">To-do</span>
        <span className="font-meta text-[12px] text-mut">
          {openItems.length === 0 ? 'all clear' : `${openItems.length} open`}
        </span>
        <button
          type="button"
          onClick={() => setComposing(true)}
          aria-label="New to-do"
          title="New to-do"
          className="ml-auto flex h-[24px] w-[24px] cursor-pointer items-center justify-center rounded-[4px] border-0 bg-transparent text-faint transition-colors hover:bg-hovrow hover:text-ink"
        >
          <Plus size={15} strokeWidth={2} />
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Collapse to-do list"
          className="flex h-[24px] w-[24px] cursor-pointer items-center justify-center rounded-[4px] border-0 bg-transparent text-faint transition-colors hover:bg-hovrow hover:text-ink"
        >
          <ChevronsRight size={15} strokeWidth={1.8} />
        </button>
      </div>

      {/* Adding happens in a dialog, matching the announcement board and the
          New purchase button: a form permanently occupying the top of a 280px
          rail costs more room than it earns, since most visits are to read the
          list or tick something off rather than to write. */}
      <Dialog
        open={composing}
        title="New to-do"
        width={440}
        onClose={() => setComposing(false)}
        footer={
          <>
            <PrimaryButton onClick={add}>{busy ? 'Adding…' : 'Add to my list'}</PrimaryButton>
            <GhostButton onClick={() => setComposing(false)}>Cancel</GhostButton>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label="What needs doing">
            <Input
              value={text}
              autoFocus
              placeholder="Something to remember…"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') add() }}
            />
          </Field>
          <Field label="Due" hint="Leave blank if it has no date.">
            <span className="flex flex-col gap-[6px]">
              <Input
                type="date"
                value={due}
                onChange={(e) => setDue(e.target.value)}
                aria-label="Due date for the new to-do"
              />
              <span className="flex gap-[6px]">
                {DUE_SHORTCUTS.map((c) => {
                  const value = dayString(c.offset)
                  return (
                    <button
                      key={c.label}
                      type="button"
                      onClick={() => setDue(value)}
                      className={`cursor-pointer rounded-[4px] border-0 px-[7px] py-[3px] font-meta text-[12px] transition-colors ${
                        due === value ? 'bg-tealbadge font-semibold text-tealbtn' : 'bg-fill2 text-mut hover:text-ink'
                      }`}
                    >
                      {c.label}
                    </button>
                  )
                })}
                {due && (
                  <button
                    type="button"
                    onClick={() => setDue('')}
                    className="cursor-pointer border-0 bg-transparent px-1 font-meta text-[12px] text-faint hover:text-redtext"
                  >
                    Clear
                  </button>
                )}
              </span>
            </span>
          </Field>
        </div>
      </Dialog>

      <div className="flex-1 overflow-y-auto">
        {grouped.map(({ bucket, items }) => (
          <div key={bucket}>
            <p className={`m-0 px-3 pb-[3px] pt-[10px] font-meta text-[10px] font-semibold uppercase tracking-[.09em] ${
              bucket === 'overdue' ? 'text-redtext' : 'text-faint'
            }`}>
              {BUCKET_LABEL[bucket]} · {items.length}
            </p>
            {items.map((t) => <TodoRow key={t.id} todo={t} today={today} />)}
          </div>
        ))}

        {openItems.length === 0 && (
          <p className="px-3 py-8 text-center text-[13px] text-faint">
            {doneItems.length > 0 ? 'All done.' : 'Nothing on your list.'}
          </p>
        )}

        {doneItems.length > 0 && (
          <div className="mt-2 border-t border-line">
            <button
              type="button"
              onClick={() => setShowDone((v) => !v)}
              className="w-full cursor-pointer border-0 bg-transparent px-3 py-[8px] text-left font-meta text-[12px] font-semibold text-mut hover:text-ink"
            >
              {showDone ? 'Hide done' : `Show done · ${doneItems.length}`}
            </button>
            {showDone && doneItems.map((t) => <TodoRow key={t.id} todo={t} today={today} />)}
          </div>
        )}
      </div>
    </aside>
  )
}
