import { useEffect, useRef, useState } from 'react'
import { RecordLink } from '../../lib/peek'
import { ArrowUpRight, Check, Pencil, Plus } from 'lucide-react'
import { useTable } from '../../lib/data'
import { repos } from '../../data/repo'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../components/Toast'
import { recordHref } from '../../lib/deepLink'
import { dayISO, fmtDayMonth, todayISO } from '../../lib/format'
import { BottomSheet, CardList, Fab, FieldBody, FieldChoice, FieldEmpty, FieldHeader, FieldInput, FieldSectionLabel, Pill, ScreenStack, SummaryStrip, motionOK } from './shell'
import type { Todo } from '../../data/types'

/**
 * The field seat's to-do list, on the phone.
 *
 * The desktop rail never reached a crew or agent seat - the phone shell mounts
 * only its work screens - so a task a manager assigned to a driver was written
 * to a list nobody could open. This is that list, in the phone's own idiom:
 * the day's figures on top, the items under Overdue, Today, Tomorrow and
 * Later with a tick big enough for a thumb, and the add button where the
 * other screens keep theirs, opening a one-line sheet.
 *
 * The server scopes `todos` to the seat (own items, plus any assigned to it),
 * so there is nothing to filter here beyond "not the ones I assigned to
 * others" - a field seat cannot assign, so that set is empty anyway.
 */
type Bucket = 'overdue' | 'today' | 'tomorrow' | 'later' | 'none'
const ORDER: Bucket[] = ['overdue', 'today', 'tomorrow', 'later', 'none']
const LABEL: Record<Bucket, string> = { overdue: 'Overdue', today: 'Today', tomorrow: 'Tomorrow', later: 'Later', none: 'No date' }

function bucketOf(t: Todo, today: string, tomorrow: string): Bucket {
  if (!t.dueDate) return 'none'
  const d = dayISO(t.dueDate)
  if (d < today) return 'overdue'
  if (d === today) return 'today'
  if (d === tomorrow) return 'tomorrow'
  return 'later'
}

const RECORD_WORD: Record<string, string> = {
  sales: 'Sale', purchases: 'Purchase', deliveries: 'Trip', customers: 'Customer', suppliers: 'Supplier',
}

/** Open items on the seat's own list - what the tab badge counts. */
export function openTaskCount(todos: Todo[] | undefined, seatId: string | undefined): number {
  if (!todos || !seatId) return 0
  return todos.filter((t) => t.seatId === seatId && !t.done).length
}

export default function MyTasks() {
  const { seat } = useAuth()
  const todos = useTable('todos')
  const toast = useToast()
  const [text, setText] = useState('')
  /** The sheet: adding, or editing one item. Same sheet, same fields. */
  const [sheet, setSheet] = useState<{ mode: 'add' } | { mode: 'edit'; todo: Todo } | null>(null)
  /** Due date as yyyy-MM-dd; '' is no date. */
  const [due, setDue] = useState('')
  const [busy, setBusy] = useState(false)
  const [showDone, setShowDone] = useState(false)
  /** Rows ticked but not yet written: held in place, shown done, then folded
   *  away before the write moves them. Keyed by id; the value is the state
   *  the row is heading to. */
  const [settling, setSettling] = useState<Record<string, boolean>>({})
  const [justAdded, setJustAdded] = useState<string | null>(null)
  const [leaving, setLeaving] = useState<Set<string>>(new Set())
  const timers = useRef<number[]>([])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  const release = (id: string) => {
    setSettling((s) => { if (!(id in s)) return s; const n = { ...s }; delete n[id]; return n })
    setLeaving((s) => { if (!s.has(id)) return s; const n = new Set(s); n.delete(id); return n })
  }
  useEffect(() => {
    for (const id of Object.keys(settling)) {
      const row = todos?.find((t) => t.id === id)
      if (!row || row.done === settling[id]) release(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todos, settling])
  if (!todos || !seat) return null

  const today = todayISO()
  const tomorrow = dayISO(new Date(Date.now() + 86_400_000).toISOString())
  const mine = todos
    .filter((t) => t.seatId === seat.id)

    .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || b.createdAt.localeCompare(a.createdAt))
  const open = mine.filter((t) => !t.done)
  const done = mine.filter((t) => t.done)
  const overdue = open.filter((t) => bucketOf(t, today, tomorrow) === 'overdue')
  const dueToday = open.filter((t) => bucketOf(t, today, tomorrow) === 'today')
  const groups = ORDER.map((b) => ({ b, items: open.filter((t) => bucketOf(t, today, tomorrow) === b) })).filter((g) => g.items.length > 0)

  function openAdd() { setText(''); setDue(''); setSheet({ mode: 'add' }) }
  function openEdit(t: Todo) { setText(t.text); setDue(t.dueDate ? dayISO(t.dueDate) : ''); setSheet({ mode: 'edit', todo: t }) }
  function closeSheet() { setSheet(null); setText(''); setDue('') }

  async function save() {
    const value = text.trim()
    if (!value || sheet?.mode !== 'edit') return
    setBusy(true)
    try {
      // '' rather than undefined to clear: update merges server-side and
      // JSON drops undefined keys.
      await repos.todos.update(sheet.todo.id, { text: value, dueDate: due ? new Date(due).toISOString() : '' })
      closeSheet()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Unable to save this task.')
    } finally {
      setBusy(false)
    }
  }

  async function add() {
    const value = text.trim()
    if (!value) return
    setBusy(true)
    try {
      const made = await repos.todos.add({ seatId: seat!.id, text: value, done: false, ...(due ? { dueDate: new Date(due).toISOString() } : {}) })
      closeSheet()
      if (made?.id) {
        setJustAdded(made.id)
        timers.current.push(window.setTimeout(() => setJustAdded(null), 1400))
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Unable to add this task.')
    } finally {
      setBusy(false)
    }
  }

  /**
   * Ticking is in three beats where motion is on: the row shows itself done
   * where it is (so the tap is seen to land), folds away, and only then is
   * the change written - which is what moves it to the other section. With
   * motion off it is one write.
   */
  const tick = (t: Todo) => {
    if (settling[t.id] !== undefined) return
    if (!motionOK()) { repos.todos.update(t.id, { done: !t.done }); return }
    setSettling((s) => ({ ...s, [t.id]: !t.done }))
    timers.current.push(window.setTimeout(() => setLeaving((s) => new Set(s).add(t.id)), 520))
    timers.current.push(window.setTimeout(() => {
      // The hold is released by the effect above, once the table shows the
      // change - not here, or the row would spring back for the beat between
      // the write and the refetch. On failure it is released at once.
      repos.todos.update(t.id, { done: !t.done }).catch((e) => {
        toast(e instanceof Error ? e.message : 'Unable to update this task.')
        release(t.id)
      })
    }, 760))
  }

  return (
    <ScreenStack screen="tasks" depth={0}>
      <FieldHeader title="My tasks" />

      <FieldBody className="!pt-[14px] !pb-0">
        <SummaryStrip
          cells={[
            { label: 'Open', value: open.length, format: Math.round },
            { label: 'Overdue', value: overdue.length, format: Math.round, tone: overdue.length > 0 ? 'act' : 'mut' },
            { label: 'Today', value: dueToday.length, format: Math.round, tone: 'mut' },
          ]}
        />

      </FieldBody>

      <FieldBody className="!pt-0 pb-[76px]">
        {open.length === 0 && (
          <FieldEmpty>{done.length > 0 ? 'All done for now.' : 'Nothing on your list.'}</FieldEmpty>
        )}

        {groups.map(({ b, items }) => (
          <div key={b}>
            <FieldSectionLabel>
              <span className={b === 'overdue' ? 'text-redtext' : undefined}>{LABEL[b]} · {items.length}</span>
            </FieldSectionLabel>
            <CardList>
              {items.map((t) => <TaskRow key={t.id} todo={t} today={today} tomorrow={tomorrow} onTick={() => tick(t)} onEdit={() => openEdit(t)} shownDone={settling[t.id]} leaving={leaving.has(t.id)} fresh={t.id === justAdded} />)}
            </CardList>
          </div>
        ))}

        {done.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => setShowDone((v) => !v)}
              className="mt-[10px] h-[44px] w-full cursor-pointer rounded-[11px] border border-inputline bg-white font-meta text-[14px] font-semibold text-lab transition-transform duration-150 active:scale-[.98] motion-reduce:transition-none"
            >
              {showDone ? 'Hide done' : `Show done · ${done.length}`}
            </button>
            {showDone && (
              <div className="todo-done-up mt-[12px]">
                <CardList>
                  {done.map((t) => <TaskRow key={t.id} todo={t} today={today} tomorrow={tomorrow} onTick={() => tick(t)} onEdit={() => openEdit(t)} shownDone={settling[t.id]} leaving={leaving.has(t.id)} />)}
                </CardList>
              </div>
            )}
          </>
        )}
      </FieldBody>

      <Fab onClick={openAdd} icon={<Plus size={17} strokeWidth={2.4} />} label="Add a task" />

      {sheet && (
        <BottomSheet label={sheet.mode === 'edit' ? 'Edit task' : 'Add a task'} onClose={closeSheet}>
          <p className="m-0 mb-[12px] text-[17px] font-semibold">{sheet.mode === 'edit' ? 'Edit task' : 'Add a task'}</p>
          <input
            autoFocus
            value={text}
            placeholder="What needs doing?"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') (sheet.mode === 'edit' ? save() : add()) }}
            aria-label="Task"
            className="box-border h-[48px] w-full rounded-[11px] border border-inputline bg-white px-[14px] text-[16px] text-ink outline-none transition-colors placeholder:text-faint focus:border-ink"
          />
          <p className="m-0 mb-[8px] mt-[14px] font-meta text-[12px] font-semibold uppercase tracking-[.08em] text-mut">When</p>
          <FieldChoice
            value={due === '' ? 'none' : due === today ? 'today' : due === tomorrow ? 'tomorrow' : 'date'}
            onChange={(v) => setDue(v === 'today' ? today : v === 'tomorrow' ? tomorrow : v === 'none' ? '' : due || today)}
            options={[{ value: 'none', label: 'No date' }, { value: 'today', label: 'Today' }, { value: 'tomorrow', label: 'Tomorrow' }, { value: 'date', label: 'Pick' }]}
          />
          {due !== '' && due !== today && due !== tomorrow && (
            <FieldInput type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due date" className="mt-[8px]" />
          )}
          <button
            type="button"
            onClick={sheet.mode === 'edit' ? save : add}
            disabled={busy || !text.trim()}
            className="mt-[14px] h-[48px] w-full cursor-pointer rounded-[11px] border-0 bg-ink text-[15px] font-semibold text-white transition-opacity disabled:cursor-default disabled:opacity-40"
          >
            {sheet.mode === 'edit' ? 'Save' : 'Add to my list'}
          </button>
        </BottomSheet>
      )}
    </ScreenStack>
  )
}

/** One task: a thumb-sized tick, the text, and the facts as chips. */
function TaskRow({ todo, today, tomorrow, onTick, onEdit, shownDone, leaving, fresh }: {
  todo: Todo; today: string; tomorrow: string; onTick: () => void; onEdit: () => void
  /** What the tick shows while a change settles; the record's own state otherwise. */
  shownDone?: boolean
  leaving?: boolean
  fresh?: boolean
}) {
  const b = bucketOf(todo, today, tomorrow)
  const done = shownDone ?? todo.done
  const overdue = !done && b === 'overdue'
  const href = todo.tbl && todo.recordId ? recordHref(todo.tbl, todo.recordId) : null
  const when = !todo.dueDate ? null : b === 'today' ? 'Today' : b === 'tomorrow' ? 'Tomorrow' : fmtDayMonth(todo.dueDate)
  return (
    <div className={`task-row border-b border-linesoft last:border-b-0 ${leaving ? 'is-leaving' : ''} ${fresh ? 'task-new' : ''}`}>
    <label className={`relative flex cursor-pointer items-start gap-[12px] py-[13px] pl-[16px] pr-[16px] transition-opacity duration-200 ${todo.done && !leaving ? 'opacity-60' : ''}`}>
      <span aria-hidden className={`absolute inset-y-0 left-0 w-[3px] transition-colors duration-300 ${overdue ? 'bg-redf' : b === 'today' && !done ? 'bg-ink' : 'bg-transparent'}`} />
      <input
        type="checkbox"
        checked={done}
        onChange={onTick}
        aria-label={done ? `Mark "${todo.text}" not done` : `Mark "${todo.text}" done`}
        className="peer sr-only"
      />
      {/* The native box is square whatever the class says; this is the round
          tick the agenda uses, driven by the hidden input above. */}
      <span
        aria-hidden
        className="task-tick mt-[1px] flex h-[24px] w-[24px] shrink-0 items-center justify-center rounded-full border-[1.5px] border-inputline bg-white text-white transition-colors duration-200 peer-checked:border-ink peer-checked:bg-ink peer-focus-visible:ring-2 peer-focus-visible:ring-ink/30"
      >
        <Check size={14} strokeWidth={3} className={done ? 'opacity-100' : 'opacity-0'} />
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block text-[15px] leading-[1.35] transition-colors duration-200 ${done ? 'text-mut' : 'text-ink'}`}>
          <span className={`task-text ${done ? 'is-done motion-reduce:line-through' : ''}`}>{todo.text}</span>
        </span>
        {(when || href || todo.assignedByName) && (
          <span className="mt-[6px] flex flex-wrap items-center gap-[6px]">
            {when && <Pill text={when} tone={overdue ? 'act' : 'plain'} />}
            {href && (
              // A link inside a label would toggle the tick as well as follow;
              // stopping propagation keeps it to the one thing tapped.
              <RecordLink
                to={href}
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-[3px] rounded-full bg-tealbadge px-[9px] py-[3px] font-meta text-[11px] font-semibold text-tealtext no-underline"
              >
                {RECORD_WORD[todo.tbl ?? ''] ?? todo.tbl} <ArrowUpRight size={11} strokeWidth={2.4} />
              </RecordLink>
            )}
            {todo.assignedByName && <span className="font-meta text-[12px] text-mut">from {todo.assignedByName}</span>}
          </span>
        )}
      </span>
      {/* A 44px target that is not the tick. Stopping the click keeps the
          label from toggling the box as well. */}
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onEdit() }}
        aria-label={`Edit "${todo.text}"`}
        className="-my-[10px] -mr-[8px] flex h-[44px] w-[40px] shrink-0 cursor-pointer items-center justify-center rounded-[10px] border-0 bg-transparent text-faint transition-colors active:bg-fill2 active:text-ink"
      >
        <Pencil size={16} strokeWidth={2} />
      </button>
    </label>
    </div>
  )
}
