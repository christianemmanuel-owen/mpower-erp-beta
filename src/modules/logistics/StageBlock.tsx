import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { fmtDateTime } from '../../lib/format'
import type { StageStamp } from '../../data/types'
import type { StageState } from '../../lib/tripStages'

/**
 * One stage of a trip: what it is, whose work it is, and what it wants.
 *
 * Passed stages collapse to their summary because a dispatcher reading a trip
 * in transit does not need eleven planning fields in front of them - but they
 * stay one click from being reopened, since corrections are ordinary: an
 * address changes after dispatch and someone has to fix it. Nothing here locks.
 */
export default function StageBlock({
  id, title, owner, state, stamp, stampLabel, summary, action, children,
}: {
  id: string
  title: string
  owner: string
  state: StageState
  /** Who recorded this stage, once someone has. */
  stamp?: StageStamp
  /** "Booked by", "Dispatched by" - the verb for this stage's stamp. */
  stampLabel?: string
  /** The one-line-per-fact recap shown while collapsed. */
  summary?: ReactNode
  /** The stage's own action and whatever it wants to say beside it. */
  action?: ReactNode
  children: ReactNode
}) {
  const [open, setOpen] = useState(state === 'now')
  const chevron = open ? <ChevronDown size={13} /> : <ChevronRight size={13} />

  return (
    <section
      id={id}
      // Named, so the stage is a landmark a screen reader can jump between -
      // and so its action is distinguishable from the nav entry of the same
      // name, which is exactly the confusion a sighted user avoids by position.
      aria-label={title}
      className={`mb-[14px] scroll-mt-[18px] overflow-hidden rounded-[8px] border ${state === 'now' ? 'border-inputline' : 'border-line'}`}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        // Without this the header's accessible name is its whole contents -
        // "Dispatch Crew, on paper Now" - which reads badly and collides with
        // the stage's own action button.
        aria-label={`${title} stage`}
        className="flex w-full cursor-pointer items-center gap-[10px] border-b border-linesoft bg-paper px-[12px] py-[8px] text-left"
      >
        <span className="text-mut">{chevron}</span>
        <span className="font-meta text-[11px] font-semibold uppercase tracking-[.09em] text-sec">{title}</span>
        <span className="font-meta text-[12px] text-faint">{owner}</span>
        <span
          className={`ml-auto rounded-[5px] px-[7px] py-[3px] font-meta text-[11px] font-semibold uppercase tracking-[.05em] ${
            state === 'now'
              ? 'bg-ink text-white'
              : state === 'done'
                ? 'bg-fill2 text-mut'
                : 'text-faint ring-1 ring-inset ring-line'
          }`}
        >
          {state === 'now' ? 'Now' : state === 'done' ? 'Done' : 'Later'}
        </span>
      </button>

      {!open && (summary || stamp) && (
        <div className="px-[12px] py-[9px]">
          {summary}
          {stamp && <StampLine stamp={stamp} label={stampLabel} className={summary ? 'mt-[9px]' : ''} />}
        </div>
      )}

      {open && (
        <>
          <div className="px-[12px] py-[14px]">
            {children}
            {stamp && <StampLine stamp={stamp} label={stampLabel} className="mt-[14px]" />}
          </div>
          {action && (
            <div className="flex items-center gap-[10px] border-t border-linesoft bg-paper px-[12px] py-[9px]">{action}</div>
          )}
        </>
      )}
    </section>
  )
}

/**
 * "Dispatched by M. Reyes · Sep 12, 07:42".
 *
 * Written by the stage actions rather than by a save, so it means the handoff
 * happened and not that someone opened the form. Where a stage records work
 * done by crew - who have no seats and cannot sign in - the person who signed
 * the paper is named beside the person who typed it in.
 */
function StampLine({ stamp, label = 'Recorded by', className = '' }: {
  stamp: StageStamp
  label?: string
  className?: string
}) {
  return (
    <p className={`m-0 font-meta text-[12px] text-mut ${className}`}>
      {label} <span className="font-semibold text-lab">{stamp.byName ?? 'someone'}</span>
      {' · '}
      {fmtDateTime(stamp.at)}
    </p>
  )
}

/** The collapsed recap: label above value, several to a row. */
export function StageFacts({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <div className="grid grid-cols-2 gap-x-[18px] gap-y-[2px]">
      {items.map((it) => (
        <div key={it.label} className="flex items-baseline justify-between gap-3 py-[2px]">
          <span className="font-meta text-[12px] text-mut">{it.label}</span>
          <span className="min-w-0 truncate text-[13px] font-semibold">{it.value}</span>
        </div>
      ))}
    </div>
  )
}
