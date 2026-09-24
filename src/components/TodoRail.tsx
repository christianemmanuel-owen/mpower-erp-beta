import { useEffect, useMemo, useState } from 'react'
import { RecordLink } from '../lib/peek'
import { ArrowUpRight, CheckSquare, ChevronsRight, Maximize2, Pencil, Plus, X } from 'lucide-react'
import { Avatar, Dialog, GhostButton, PrimaryButton } from './ui'
import { useTables } from '../lib/data'
import { useAuth } from '../lib/auth'
import { resolveWidgets } from '../lib/dashboardConfig'
import { repos } from '../data/repo'
import { recordHref } from '../lib/deepLink'
import { fmtDate } from '../lib/format'
import type { Todo } from '../data/types'

/**
 * The seat's own to-do list, as a collapsible rail beside every screen - drawn
 * as the day's agenda rather than a checklist.
 *
 * It used to be a card on the dashboard. That wasted the feature it was built
 * around: a to-do can carry a deep link to the record it is about (`tbl` +
 * `recordId`), so "chase Acme PO" opens the sale. A link like that only pays off
 * if the list is visible *while you work somewhere else*, so it lives in a rail
 * that stays open across Sales, Stock and Trips.
 *
 * The shape: the header is today - the date, a ring of how much is done, one
 * line of what is left. Under it a composer that is always there, because
 * writing an item down is a two-second act and a dialog for it was a tax on
 * every one; the dialog is still a click away for a date, a record or an
 * assignee. Items are cards under Overdue / Today / Tomorrow / Later, with a
 * coloured rule saying which, a round tick, and chips for the date, the record
 * and who assigned it - the facts as marks, not as a sentence per row.
 *
 * "Per user" is still load-bearing: a note somebody writes to themselves is
 * theirs, and the server scopes `todos` to the owning seat (see
 * OWN_SEAT_TABLES in the API route), so a manager genuinely cannot read what
 * an encoder wrote to themselves - admins included. The one addition is
 * assignment: an administrator or approver may put an item on somebody else's
 * list, and that item is visible to the two of them and nobody else. The
 * server sets `assignedById`; the client only ever names the list.
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

/** The date as a short word where one exists, else the short date. */
function dueWord(t: Todo, today: string, tomorrow: string): string {
  const b = bucketOf(t, today, tomorrow)
  if (b === 'today') return 'Today'
  if (b === 'tomorrow') return 'Tomorrow'
  return t.dueDate ? fmtDate(t.dueDate).replace(/, \d{4}$/, '') : ''
}

const DUE_SHORTCUTS: { label: string; offset: number }[] = [
  { label: 'Today', offset: 0 },
  { label: 'Tomorrow', offset: 1 },
  { label: 'Next week', offset: 7 },
]

const RECORD_WORD: Record<string, string> = {
  sales: 'Sale', purchases: 'Purchase', deliveries: 'Trip', customers: 'Customer', suppliers: 'Supplier', personnel: 'Employee',
}

const dateInputCls =
  'box-border rounded-[6px] border border-inputline bg-white px-[7px] py-[3px] font-meta text-[12px] font-[inherit] text-ink focus:border-ink focus:outline-none'

/** A small round tick. A styled checkbox, so the keyboard and screen readers
 *  still get a checkbox. */
function Tick({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <span className="relative mt-[1px] inline-flex h-[18px] w-[18px] shrink-0">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        aria-label={label}
        className="peer absolute inset-0 m-0 cursor-pointer opacity-0"
      />
      <span
        aria-hidden
        className={`pointer-events-none inline-flex h-[18px] w-[18px] items-center justify-center rounded-full border-[1.5px] transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ink/30 ${
          checked ? 'border-ink bg-ink text-white' : 'border-inputline bg-white'
        }`}
      >
        {checked && <span className="mb-[2px] block h-[9px] w-[5px] rotate-45 border-b-2 border-r-2 border-white" />}
      </span>
    </span>
  )
}

/** One item, as a card. The rule on its left says when; the chips say the rest. */
function TodoCardRow({ todo, today, tomorrow, seatId, assigneeName, onEdit }: {
  todo: Todo
  today: string
  tomorrow: string
  /** The signed-in seat, to tell "from X" (on my list) from "for X" (I assigned it). */
  seatId: string
  assigneeName?: string
  onEdit: () => void
}) {
  const href = todo.tbl && todo.recordId ? recordHref(todo.tbl, todo.recordId) : null
  const bucket = bucketOf(todo, today, tomorrow)
  const overdue = !todo.done && bucket === 'overdue'
  const [editingDate, setEditingDate] = useState(false)

  // Clearing sends '' rather than undefined: update is a merge server-side and
  // JSON.stringify drops undefined keys, so '' is the only way to blank it.
  function setDue(value: string) {
    repos.todos.update(todo.id, { dueDate: value ? new Date(value).toISOString() : '' })
    setEditingDate(false)
  }

  const rule = todo.done ? 'bg-inputline' : overdue ? 'bg-redf' : bucket === 'today' ? 'bg-ink' : 'bg-inputline'

  return (
    <div className={`group relative mb-[6px] flex gap-[10px] overflow-hidden rounded-[10px] border border-line bg-white py-[9px] pl-[12px] pr-[10px] transition-colors hover:border-inputline ${todo.done ? 'opacity-60' : ''}`}>
      <span aria-hidden className={`absolute inset-y-0 left-0 w-[3px] ${rule}`} />
      <Tick
        checked={todo.done}
        onChange={() => repos.todos.update(todo.id, { done: !todo.done })}
        label={todo.done ? `Mark "${todo.text}" not done` : `Mark "${todo.text}" done`}
      />
      <span className="min-w-0 flex-1">
        <span className={`block text-[13px] leading-[1.35] ${todo.done ? 'text-mut line-through' : 'text-ink'}`}>
          {todo.text}
        </span>
        {(editingDate || todo.dueDate || href || todo.assignedByName || assigneeName || !todo.done) && (
        <span className="mt-[6px] flex flex-wrap items-center gap-[5px]">
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
          ) : (todo.dueDate || !todo.done) && (
            <button
              type="button"
              onClick={() => setEditingDate(true)}
              aria-label={todo.dueDate ? `Change due date, currently ${fmtDate(todo.dueDate)}` : 'Add a due date'}
              className={`cursor-pointer rounded-[5px] border-0 px-[6px] py-[2px] font-meta text-[11px] font-semibold transition-colors ${
                overdue ? 'bg-redbadge text-redtext'
                  : todo.dueDate ? 'bg-fill2 text-sec hover:text-ink'
                  : 'bg-transparent text-transparent hover:bg-fill2 hover:text-mut group-hover:text-faint'
              }`}
            >
              {todo.dueDate ? dueWord(todo, today, tomorrow) : '+ date'}
            </button>
          )}
          {href && (
            <RecordLink
              to={href}
              className="inline-flex items-center gap-[3px] rounded-[5px] bg-tealbadge px-[6px] py-[2px] font-meta text-[11px] font-semibold text-tealtext no-underline hover:underline"
            >
              {RECORD_WORD[todo.tbl ?? ''] ?? todo.tbl} <ArrowUpRight size={10} strokeWidth={2.4} />
            </RecordLink>
          )}
          {todo.assignedByName && todo.seatId === seatId && (
            <span className="inline-flex items-center gap-[5px] font-meta text-[11px] text-mut">
              <Avatar name={todo.assignedByName} size={16} />
              <span className="truncate">from {todo.assignedByName}</span>
            </span>
          )}
          {assigneeName && (
            <span className="inline-flex items-center gap-[5px] font-meta text-[11px] text-mut">
              <Avatar name={assigneeName} size={16} />
              <span className="truncate">for {assigneeName}</span>
            </span>
          )}
        </span>
        )}
      </span>
      {/* Edit and delete surface together on hover, edit first: the more
          common and the less final of the two. */}
      <span className="flex shrink-0 items-start gap-[2px]">
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit "${todo.text}"`}
          className="mt-[1px] h-[18px] w-[18px] shrink-0 cursor-pointer rounded-[4px] border-0 bg-transparent p-0 text-transparent transition-colors group-hover:text-faint hover:!bg-fill2 hover:!text-ink"
        >
          <Pencil size={11} strokeWidth={2.2} className="mx-auto" />
        </button>
        <button
          type="button"
          onClick={() => repos.todos.remove(todo.id)}
          aria-label={`Delete "${todo.text}"`}
          className="mt-[1px] h-[18px] w-[18px] shrink-0 cursor-pointer rounded-[4px] border-0 bg-transparent p-0 text-transparent transition-colors group-hover:text-faint hover:!bg-redbadge hover:!text-redtext"
        >
          <X size={12} strokeWidth={2.2} className="mx-auto" />
        </button>
      </span>
    </div>
  )
}

/** How much of the day is done, as a ring. Conic gradient, no SVG to size. */
function Ring({ done, total }: { done: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100)
  return (
    <span
      role="img"
      aria-label={`${done} of ${total} done`}
      className="grid h-[40px] w-[40px] shrink-0 place-items-center rounded-full"
      style={{ background: `conic-gradient(var(--color-ink) 0 ${pct}%, var(--color-line) ${pct}% 100%)` }}
    >
      <span className="tnum grid h-[30px] w-[30px] place-items-center rounded-full bg-sidebar font-meta text-[11px] font-semibold text-ink">
        {total === 0 ? '·' : `${done}/${total}`}
      </span>
    </span>
  )
}

export default function TodoRail() {
  const { seat } = useAuth()
  const data = useTables(['todos', 'dashboardConfigs', 'seats'] as const)

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
  /** The item the dialog is editing, or null when it is composing a new one.
   *  The same dialog serves both: same line, same When pills. */
  const [editing, setEditing] = useState<Todo | null>(null)
  /** Whose list the new item goes on. '' is my own. */
  const [forSeat, setForSeat] = useState('')

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

  const byDue = (a: Todo, b: Todo) => {
    const ad = a.dueDate ?? '9999'
    const bd = b.dueDate ?? '9999'
    if (ad !== bd) return ad.localeCompare(bd)
    return b.createdAt.localeCompare(a.createdAt)
  }
  const mine = useMemo(() => {
    if (!data || !seat) return []
    return data.todos.filter((t) => t.seatId === seat.id).sort(byDue)
  }, [data, seat])
  // What I put on other people's lists. The server returns these alongside my
  // own, so a manager can see whether they were done without asking.
  const assigned = useMemo(() => {
    if (!data || !seat) return []
    return data.todos.filter((t) => t.seatId !== seat.id && t.assignedById === seat.id).sort(byDue)
  }, [data, seat])
  const canAssign = Boolean(seat?.isAdmin || seat?.canApprove)
  const seatName = (id: string) => data?.seats.find((s) => s.id === id)?.name ?? 'someone'

  // The rail is still governed by the `todos` widget key, so a role that does
  // not want it can untick it on the Dashboard roles screen exactly as before.
  const enabled = !!data && !!seat && resolveWidgets(seat, data.dashboardConfigs).includes('todos')

  // The rail is fixed-position, so it can't push the page itself. It publishes
  // its own width instead and the Shell reserves that much room.
  useEffect(() => {
    const width = !enabled ? '0px' : open ? '280px' : '44px'
    document.documentElement.style.setProperty('--todo-rail-w', width)
    return () => document.documentElement.style.setProperty('--todo-rail-w', '0px')
  }, [enabled, open])

  if (!enabled || !data || !seat) return null

  const openItems = mine.filter((t) => !t.done)
  const doneItems = mine.filter((t) => t.done)
  const overdueCount = openItems.filter((t) => bucketOf(t, today, tomorrow) === 'overdue').length
  // The ring is about today: what was due by today, and how much of it is done.
  const dueByToday = mine.filter((t) => t.dueDate && t.dueDate.slice(0, 10) <= today)
  const ringDone = dueByToday.filter((t) => t.done).length

  const grouped = BUCKET_ORDER
    .map((b) => ({ bucket: b, items: openItems.filter((t) => bucketOf(t, today, tomorrow) === b) }))
    .filter((g) => g.items.length > 0)

  function startEdit(t: Todo) {
    setEditing(t)
    setText(t.text)
    setDue(t.dueDate ? t.dueDate.slice(0, 10) : '')
    setForSeat('')
    setComposing(true)
  }

  function closeDialog() {
    setComposing(false)
    if (editing) { setEditing(null); setText(''); setDue('') }
  }

  async function add() {
    const value = text.trim()
    if (!value || !seat) return
    setBusy(true)
    try {
      if (editing) {
        // Whose list it is on cannot change here - the server strips seatId on
        // update - so an edit is the words and the date, nothing else.
        await repos.todos.update(editing.id, { text: value, dueDate: due ? new Date(due).toISOString() : '' })
        setEditing(null)
        setText('')
        setDue('')
        setComposing(false)
        return
      }
      await repos.todos.add({
        // The server only honours another seat's id from an admin or approver
        // and stamps who assigned it; for everyone else this is always mine.
        seatId: forSeat || seat.id,
        text: value,
        done: false,
        ...(due ? { dueDate: new Date(due).toISOString() } : {}),
      })
      setText('')
      setDue('')
      setForSeat('')
      setComposing(false)
    } finally {
      setBusy(false)
    }
  }

  const dateLabel = new Date().toLocaleDateString('en-PH', { weekday: 'long', month: 'short', day: 'numeric' })
  const summary = openItems.length === 0
    ? (doneItems.length > 0 ? 'All done' : 'Nothing on your list')
    : `${openItems.length} open${overdueCount > 0 ? ` · ${overdueCount} overdue` : ''}`

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

  const forName = forSeat ? seatName(forSeat) : ''
  const previewDue = due ? (due === today ? 'Today' : due === tomorrow ? 'Tomorrow' : fmtDate(due).replace(/, \d{4}$/, '')) : ''

  return (
    <aside className="fixed inset-y-0 right-0 z-[1000] flex w-[280px] flex-col border-l border-line bg-sidebar">
      <div className="flex items-center gap-[12px] border-b border-line px-[14px] pb-[10px] pt-[14px]">
        <Ring done={ringDone} total={dueByToday.length} />
        <div className="min-w-0 flex-1">
          <p className="m-0 font-meta text-[10px] font-semibold uppercase tracking-[.09em] text-mut">{dateLabel}</p>
          <p className="m-0 mt-[1px] text-[15px] font-semibold leading-[1.2]">To-do</p>
          <p className="m-0 mt-[1px] truncate font-meta text-[12px] text-mut">{summary}</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Collapse to-do list"
          className="flex h-[26px] w-[26px] shrink-0 cursor-pointer items-center justify-center rounded-[6px] border-0 bg-transparent text-mut transition-colors hover:bg-hovrow hover:text-ink"
        >
          <ChevronsRight size={15} strokeWidth={1.8} />
        </button>
      </div>

      {/* The composer, always there: type and Enter for a plain item; the
          expand opens the full form for a date, a record or an assignee. */}
      <div className="mx-[12px] mt-[10px] flex items-center gap-[8px] rounded-[10px] border border-line bg-white py-[6px] pl-[10px] pr-[6px] transition-colors focus-within:border-ink">
        <Plus size={14} strokeWidth={2} className="shrink-0 text-faint" />
        <input
          value={editing ? '' : text}
          placeholder="Add a to-do…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add() }}
          aria-label="Add a to-do"
          className="min-w-0 flex-1 border-0 bg-transparent p-0 text-[13px] text-ink outline-none placeholder:text-faint"
        />
        {/* A word, not only a glyph: "Details" says what the fuller form is
            for, which a bare expand icon did not. */}
        <button
          type="button"
          onClick={() => setComposing(true)}
          aria-label="New to-do"
          title="Add with a date, a record or an assignee"
          className="flex h-[22px] shrink-0 cursor-pointer items-center gap-[4px] rounded-[5px] border-0 bg-fill2 px-[7px] font-meta text-[11px] font-semibold text-sec transition-colors hover:bg-hovrow hover:text-ink"
        >
          Details <Maximize2 size={10} strokeWidth={2.2} />
        </button>
      </div>

      <Dialog
        open={composing}
        title={editing ? 'Edit to-do' : 'New to-do'}
        width={520}
        onClose={closeDialog}
        footer={
          <>
            <span className="mr-auto font-meta text-[12px] text-faint">{editing ? '↵ to save' : '↵ to add'} · Esc to close</span>
            <GhostButton onClick={closeDialog}>Cancel</GhostButton>
            <PrimaryButton onClick={add} disabled={busy || !text.trim()}>
              {busy ? (editing ? 'Saving…' : 'Adding…') : editing ? 'Save' : forSeat ? `Assign to ${forName}` : 'Add to my list'}
            </PrimaryButton>
          </>
        }
      >
        {/* One line to type into, then the choices as pills. A form of
            labelled fields for a sentence and a date was more chrome than
            content. */}
        <label className="block">
          <span className="mb-[6px] block font-meta text-[10px] font-semibold uppercase tracking-[.09em] text-mut">To-do</span>
          <input
            value={text}
            autoFocus
            placeholder="What needs doing?"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') add() }}
            aria-label="What needs doing"
            className="block w-full rounded-[8px] border border-inputline bg-white px-[12px] py-[9px] text-[15px] font-medium leading-[1.3] text-ink outline-none transition-colors placeholder:font-normal placeholder:text-faint focus:border-ink"
          />
        </label>

        <p className="m-0 mb-[8px] mt-[18px] font-meta text-[10px] font-semibold uppercase tracking-[.09em] text-mut">When</p>
        <div className="flex flex-wrap items-center gap-[6px]">
          {DUE_SHORTCUTS.map((c) => {
            const value = dayString(c.offset)
            return <Pill key={c.label} on={due === value} onClick={() => setDue(value)}>{c.label}</Pill>
          })}
          <Pill on={due === ''} onClick={() => setDue('')}>No date</Pill>
          <input
            type="date"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            aria-label={editing ? 'Due date' : 'Due date for the new to-do'}
            className={`${dateInputCls} h-[30px] rounded-full px-[10px]`}
          />
        </div>

        {canAssign && !editing && (
          <>
            <p className="m-0 mb-[8px] mt-[16px] font-meta text-[10px] font-semibold uppercase tracking-[.09em] text-mut">For</p>
            <div role="radiogroup" aria-label="For" className="flex flex-wrap gap-[6px]">
              <Person name={seat.name} label="Me" on={forSeat === ''} onClick={() => setForSeat('')} />
              {data.seats
                .filter((s) => s.id !== seat.id)
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((s) => <Person key={s.id} name={s.name} label={s.name} on={forSeat === s.id} onClick={() => setForSeat(s.id)} />)}
            </div>
          </>
        )}

        {/* What the choices add up to, as one line of text. It was a drawn
            card, which read as a second place to type. */}
        <p className="m-0 mt-[18px] border-t border-linesoft pt-[12px] font-meta text-[12px] text-mut">
          {editing
            ? `${editing.seatId === seat.id ? 'On your list' : `On ${seatName(editing.seatId)}’s list`}${previewDue ? ` · due ${previewDue.toLowerCase()}` : ' · no date'}`
            : <>
                Goes on {forSeat ? `${forName}’s` : 'your'} list
                {previewDue ? ` · due ${previewDue.toLowerCase()}` : ' · no date'}
                {forSeat ? ` · marked as from ${seat.name}` : ''}
              </>}
        </p>
      </Dialog>

      <div className="flex-1 overflow-y-auto px-[12px] pb-[12px] pt-[4px]">
        {grouped.map(({ bucket, items }) => (
          <div key={bucket} className="mt-[14px]">
            <p className={`m-0 mb-[6px] ml-[2px] flex items-baseline gap-[6px] font-meta text-[10px] font-semibold uppercase tracking-[.09em] ${
              bucket === 'overdue' ? 'text-redtext' : 'text-mut'
            }`}>
              {BUCKET_LABEL[bucket]} · {items.length}
            </p>
            {items.map((t) => <TodoCardRow key={t.id} todo={t} today={today} tomorrow={tomorrow} seatId={seat.id} onEdit={() => startEdit(t)} />)}
          </div>
        ))}

        {openItems.length === 0 && (
          <div className="mt-10 px-4 text-center">
            <p className="m-0 text-[26px]">{doneItems.length > 0 ? '✓' : '○'}</p>
            <p className="m-0 mt-[6px] font-meta text-[13px] text-mut">
              {doneItems.length > 0 ? 'All done for now.' : 'Nothing on your list.'}
            </p>
          </div>
        )}

        {/* What I have put on other people's lists, with whose it is on each
            card. Done ones stay until the assigner clears them - that is how a
            manager sees the job was finished. */}
        {assigned.length > 0 && (
          <div className="mt-[14px]">
            <p className="m-0 mb-[6px] ml-[2px] font-meta text-[10px] font-semibold uppercase tracking-[.09em] text-mut">
              Assigned to others · {assigned.filter((t) => !t.done).length} open
            </p>
            {assigned.map((t) => (
              <TodoCardRow key={t.id} todo={t} today={today} tomorrow={tomorrow} seatId={seat.id} assigneeName={seatName(t.seatId)} onEdit={() => startEdit(t)} />
            ))}
          </div>
        )}

      </div>

      {/* Done items come up from the bar that reveals them and sit against
          it, in their own scroll - the open list above keeps its place. */}
      {showDone && doneItems.length > 0 && (
        <div className="todo-done-up max-h-[45%] shrink-0 overflow-y-auto border-t border-line bg-paper px-[12px] pb-[6px] pt-[10px]">
          <p className="m-0 mb-[6px] ml-[2px] font-meta text-[10px] font-semibold uppercase tracking-[.09em] text-mut">
            Done · {doneItems.length}
          </p>
          {doneItems.map((t) => <TodoCardRow key={t.id} todo={t} today={today} tomorrow={tomorrow} seatId={seat.id} onEdit={() => startEdit(t)} />)}
        </div>
      )}

      {/* Pinned under the list, where "what have I finished" is looked for
          once the open items are read - not floating mid-scroll between them. */}
      {doneItems.length > 0 && (
        <button
          type="button"
          onClick={() => setShowDone((v) => !v)}
          className="shrink-0 cursor-pointer border-0 border-t border-line bg-sidebar px-[14px] py-[9px] text-left font-meta text-[12px] font-semibold text-mut transition-colors hover:bg-hovrow hover:text-ink"
        >
          {showDone ? 'Hide done' : `Show done · ${doneItems.length}`}
        </button>
      )}
    </aside>
  )
}

function Pill({ on, onClick, children }: { on: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`h-[30px] cursor-pointer rounded-full border px-[12px] font-meta text-[12px] font-semibold transition-colors ${
        on ? 'border-ink bg-ink text-white' : 'border-line bg-white text-lab hover:border-inputline'
      }`}
    >
      {children}
    </button>
  )
}

function Person({ name, label, on, onClick }: { name: string; label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onClick}
      className={`inline-flex h-[30px] cursor-pointer items-center gap-[7px] rounded-full border py-0 pl-[4px] pr-[11px] font-meta text-[12px] transition-colors ${
        on ? 'border-ink bg-paper font-semibold text-ink' : 'border-line bg-white text-lab hover:border-inputline'
      }`}
    >
      <Avatar name={name} size={22} />
      {label}
    </button>
  )
}
