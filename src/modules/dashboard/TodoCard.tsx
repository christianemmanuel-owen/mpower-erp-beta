import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, Input, SectionLabel } from '../../components/ui'
import { useTable } from '../../lib/data'
import { useAuth } from '../../lib/auth'
import { repos } from '../../data/repo'
import { recordHref } from '../../lib/deepLink'
import { todayISO, fmtDate } from '../../lib/format'
import type { Todo } from '../../data/types'

/**
 * To-do list, per user - Exhibit A 1.1.
 *
 * "Per user" is the whole specification, and it is load-bearing: these are
 * private notes, not assigned tasks. The list is filtered to the signed-in
 * seat's own items and nobody else's, so a manager cannot see what an encoder
 * has written to themselves. If the Client later wants delegated tasks - one
 * person assigning another - that is a different feature with a different
 * privacy story, not a filter change here.
 *
 * A to-do can carry a deep link to the record it is about (`tbl` + `recordId`),
 * so "chase Acme PO" opens the sale rather than making someone search for it.
 * Nothing sets that yet from other screens; the field is honoured here so those
 * screens can start writing it.
 */
export default function TodoCard({ delay = 0 }: { delay?: number }) {
  const { seat } = useAuth()
  const todos = useTable('todos')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [showDone, setShowDone] = useState(false)

  if (!todos || !seat) return null

  const mine = todos
    .filter((t) => t.seatId === seat.id)
    .sort((a, b) => {
      // Undone first, then by due date (undated last), then newest.
      if (a.done !== b.done) return a.done ? 1 : -1
      const ad = a.dueDate ?? '9999'
      const bd = b.dueDate ?? '9999'
      if (ad !== bd) return ad.localeCompare(bd)
      return b.createdAt.localeCompare(a.createdAt)
    })

  const open = mine.filter((t) => !t.done)
  const done = mine.filter((t) => t.done)
  const visible = showDone ? mine : open

  async function add() {
    const value = text.trim()
    if (!value || !seat) return
    setBusy(true)
    try {
      await repos.todos.add({ seatId: seat.id, text: value, done: false })
      setText('')
    } finally {
      setBusy(false)
    }
  }

  const toggle = (t: Todo) => repos.todos.update(t.id, { done: !t.done })
  const remove = (t: Todo) => repos.todos.remove(t.id)

  const overdue = (t: Todo) => !t.done && t.dueDate && t.dueDate.slice(0, 10) < todayISO()

  return (
    <Card className="p-5" delay={delay}>
      <div className="mb-3 flex items-baseline justify-between">
        <SectionLabel>My to-do list</SectionLabel>
        {done.length > 0 && (
          <button
            type="button"
            onClick={() => setShowDone((v) => !v)}
            className="cursor-pointer border-0 bg-transparent text-[12px] font-semibold text-tealtext hover:underline"
          >
            {showDone ? 'Hide done' : `Show done (${done.length})`}
          </button>
        )}
      </div>

      <div className="mb-3 flex gap-2">
        <Input
          value={text}
          placeholder="Something to remember…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add() }}
        />
        <button
          type="button"
          onClick={add}
          disabled={busy || !text.trim()}
          className="shrink-0 cursor-pointer rounded-[10px] bg-inkcard px-4 text-[13px] font-semibold text-white hover:bg-inkhov disabled:opacity-40"
        >
          Add
        </button>
      </div>

      <div className="flex flex-col">
        {visible.map((t) => {
          const href = t.tbl && t.recordId ? recordHref(t.tbl, t.recordId) : null
          return (
            <div key={t.id} className="group flex items-start gap-2 border-b border-fill2 py-[7px] text-[13px] last:border-0">
              <input
                type="checkbox"
                checked={t.done}
                onChange={() => toggle(t)}
                className="mt-[3px] cursor-pointer"
              />
              <span className={`flex-1 ${t.done ? 'text-faint line-through' : ''}`}>
                {href ? <Link to={href} className="text-lab hover:underline">{t.text}</Link> : t.text}
                {t.dueDate && (
                  <span className={`ml-2 text-[11px] ${overdue(t) ? 'font-semibold text-redtext' : 'text-faint'}`}>
                    {overdue(t) ? 'overdue · ' : ''}{fmtDate(t.dueDate)}
                  </span>
                )}
              </span>
              <button
                type="button"
                onClick={() => remove(t)}
                aria-label={`Delete "${t.text}"`}
                className="cursor-pointer border-0 bg-transparent px-1 text-[11px] font-semibold uppercase text-transparent group-hover:text-faint hover:!text-redtext"
              >
                ✕
              </button>
            </div>
          )
        })}
        {visible.length === 0 && (
          <p className="py-5 text-center text-[13px] text-faint">
            {done.length > 0 ? 'All done.' : 'Nothing on your list.'}
          </p>
        )}
      </div>
    </Card>
  )
}
