import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'

/**
 * The parts of a long form, as a list you can jump to.
 *
 * A fifteen-field form in a dialog is a scroll with five headings in it, and
 * the only way to reach the collection plan is to travel past everything
 * between. This says what the parts are, which one you are in, and which ones
 * still want something - and clicking one goes there.
 *
 * "Progress" here is deliberately not a wizard's: nothing is locked, nothing
 * has to be done in order. A form you can fill in any order should not pretend
 * otherwise; the marks report state, they do not gate it.
 */

export type SectionState = 'done' | 'problem' | 'todo'

export interface FormNavSection {
  /** Must match the `id` given to the section's FormSection. */
  id: string
  title: string
  state: SectionState
}

/**
 * Which section the form is currently showing, and how to get to another.
 *
 * Measured against the dialog's scrolling body rather than the window, because
 * that is what actually scrolls - `data-dialog-body` on Dialog marks it.
 * Positions are read with getBoundingClientRect rather than offsetTop: the two
 * elements do not share an offsetParent, so offsetTop would be measuring from
 * different origins and the highlight would sit on the wrong row.
 */
export function useSectionNav(ids: string[]) {
  const key = ids.join('|')
  const [active, setActive] = useState(ids[0] ?? '')

  useEffect(() => {
    const list = key ? key.split('|') : []
    const first = document.getElementById(list[0])
    const box = first?.closest('[data-dialog-body]') as HTMLElement | null
    if (!box) return

    function current() {
      if (!box) return
      const top = box.getBoundingClientRect().top
      let best = list[0]
      for (const id of list) {
        const el = document.getElementById(id)
        // 24px of grace, so a heading just under the top edge already counts as
        // the one you are reading.
        if (el && el.getBoundingClientRect().top - top <= 24) best = id
      }
      setActive(best)
    }

    current()
    box.addEventListener('scroll', current, { passive: true })
    return () => box.removeEventListener('scroll', current)
  }, [key])

  function jump(id: string) {
    setActive(id)
    // matchMedia is guarded rather than assumed: it is absent under jsdom and
    // in older embedded webviews, and an unguarded call here would throw out of
    // a click handler and leave the nav looking dead.
    const still = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    // scrollIntoView is guarded for the same reason as matchMedia above: it is
    // absent under jsdom, so a Save that jumps to its first bad field threw out
    // of the click handler in tests - and would in any host that lacks it,
    // taking the rest of the handler with it.
    const el = document.getElementById(id)
    if (typeof el?.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' })
    }
  }

  return { active, jump }
}

export function FormNav({ sections, active, onJump }: {
  sections: FormNavSection[]
  active: string
  onJump: (id: string) => void
}) {
  return (
    <ul className="m-0 flex list-none flex-col gap-[1px] p-0">
      {sections.map((s) => {
        const here = s.id === active
        return (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => onJump(s.id)}
              aria-current={here ? 'true' : undefined}
              className={`flex w-full cursor-pointer items-center gap-[7px] rounded-[6px] border-0 px-[8px] py-[6px] text-left font-meta text-[12px] transition-colors ${
                here ? 'bg-white font-semibold text-ink shadow-[0_1px_2px_rgba(20,24,27,.06)]' : 'bg-transparent text-mut hover:text-ink'
              }`}
            >
              <Mark state={s.state} />
              <span className="min-w-0 flex-1 truncate">{s.title}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * One section's state, at 14px.
 *
 * Red is the only colour, and only for a section holding a problem - the same
 * rule the rest of the app follows. "Done" is a grey tick rather than a green
 * one: a filled-in section is the ordinary case and needs nothing from you.
 */
function Mark({ state }: { state: SectionState }) {
  if (state === 'problem') {
    return (
      <span aria-label="needs attention" className="flex h-[14px] w-[14px] shrink-0 items-center justify-center">
        <span className="h-[6px] w-[6px] rounded-full bg-redf" />
      </span>
    )
  }
  if (state === 'done') {
    return <Check aria-label="filled in" size={13} strokeWidth={2.2} className="shrink-0 text-faint" />
  }
  return (
    <span aria-hidden className="flex h-[14px] w-[14px] shrink-0 items-center justify-center">
      <span className="h-[5px] w-[5px] rounded-full border border-inputline" />
    </span>
  )
}
