import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, Check, LogOut, Search, X } from 'lucide-react'
import { useAuth } from '../../lib/auth'

/**
 * The phone app the crew and the agents get.
 *
 * This is not the office design at a narrower width, and the difference is the
 * whole point of the file. The office screens are dense tables read with a
 * mouse at a desk; these are read one-handed at a depot gate or in a customer's
 * yard, often in sunlight, by somebody who has one job to do and wants to know
 * whether it is done. So:
 *
 * - The header is a date and a name, not a toolbar. Signing out is the least
 *   used action here, so it goes behind the avatar rather than taking the
 *   top-right corner.
 * - One card leads. The job that wants something now is bigger than the rest
 *   and carries its own action; the remainder is a quiet list.
 * - Controls are 48px and 16px. Below 16px iOS Safari zooms the page on focus
 *   and leaves it zoomed - the most common way a working form feels broken on a
 *   phone.
 * - Type runs bigger throughout: 26px page titles, 15px rows, 13px meta. The
 *   office's 12px meta is unreadable at arm's length on a bright forecourt.
 * - Colour is still earned. Red means act now and nothing else; a payment due
 *   next month is quiet.
 */

// ---- chrome -----------------------------------------------------------------

/**
 * The date, the screen's name, and the two things that live beside them.
 *
 * Search opens in place: the field grows leftward out of its own button and
 * the title slides out of its way, so the row keeps its height and nothing
 * below it moves. Closing runs the same motion in reverse.
 */
export function FieldHeader({ title, onSearch, searching, search }: {
  title: string
  /** Given when the screen has something to search. */
  onSearch?: () => void
  searching?: boolean
  /** The field itself, drawn inside the header row when `searching`. */
  search?: { value: string; onChange: (v: string) => void; placeholder: string }
}) {
  const today = new Date()
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { if (searching) input.current?.focus() }, [searching])

  return (
    <div className="relative flex items-center gap-3 px-[18px] pt-[16px]">
      <div
        aria-hidden={searching || undefined}
        className={`min-w-0 flex-1 transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none ${
          searching ? 'pointer-events-none -translate-x-3 opacity-0' : 'translate-x-0 opacity-100'
        }`}
      >
        <p className="m-0 font-meta text-[12px] font-semibold uppercase tracking-[.07em] text-mut">
          {today.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
        <h1 className="m-0 mt-[2px] text-[26px] font-semibold leading-[1.15] tracking-[-0.02em]">{title}</h1>
      </div>

      {onSearch && search && (
        // Anchored to the search button's left edge when closed, so it appears
        // to grow out of the button; `left` is what animates.
        <div
          className={`absolute top-[16px] transition-[left,opacity,visibility] duration-200 ease-out motion-reduce:transition-none ${
            searching ? 'visible left-[18px] opacity-100' : 'invisible left-[calc(100%-118px)] opacity-0'
          }`}
          style={{ right: 'calc(18px + 38px + 12px + 38px + 12px)' }}
        >
          <input
            ref={input}
            type="search"
            value={search.value}
            onChange={(e) => search.onChange(e.target.value)}
            placeholder={search.placeholder}
            aria-label={search.placeholder}
            tabIndex={searching ? 0 : -1}
            className={`${ctlBase} h-[44px] rounded-full [&::-webkit-search-cancel-button]:hidden`}
          />
        </div>
      )}

      {onSearch && (
        <button
          type="button"
          onClick={onSearch}
          aria-label={searching ? 'Close search' : 'Search'}
          aria-pressed={searching}
          className={`relative z-[1] flex h-[38px] w-[38px] shrink-0 cursor-pointer items-center justify-center rounded-full border transition-colors ${
            searching ? 'border-ink bg-ink text-white' : 'border-line bg-white text-sec'
          }`}
        >
          {searching ? <X size={16} strokeWidth={2} /> : <Search size={16} strokeWidth={2} />}
        </button>
      )}
      <AccountButton />
    </div>
  )
}

/** Who is signed in, and the way out. A sheet rather than a menu: a 38px target
 *  opening 30px rows is how people sign themselves out by accident. */
function AccountButton() {
  const { seat, logout } = useAuth()
  const [open, setOpen] = useState(false)
  const initials = (seat?.name ?? '')
    .split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('')

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Your account"
        className="flex h-[38px] w-[38px] shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-fill2 font-meta text-[13px] font-semibold text-lab"
      >
        {initials || '·'}
      </button>
      {open && (
        <BottomSheet label="Your account" onClose={() => setOpen(false)}>
            <p className="m-0 text-[17px] font-semibold">{seat?.name}</p>
            <p className="m-0 mt-[2px] font-meta text-[13px] text-mut">{seat?.role}</p>
            <button
              type="button"
              onClick={logout}
              className="mt-[18px] flex h-[48px] w-full cursor-pointer items-center justify-center gap-[8px] rounded-[11px] border border-inputline bg-white text-[15px] font-semibold text-lab"
            >
              <LogOut size={16} strokeWidth={2} /> Sign out
            </button>
        </BottomSheet>
      )}
    </>
  )
}

/**
 * A sheet rising from the bottom edge over a dimmed page, for the small
 * things that do not deserve a whole screen: one field, a couple of rows.
 * Tapping the dim closes it. Sits above the tab bar.
 */
export function BottomSheet({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  // Into <body>, the way Dialog is: rendered in place it sat inside the page's
  // fade-in, whose transform made the page - not the screen - the box that
  // `fixed` measures from, and the tab bar (a sibling of the page) drew over
  // it. The account sheet's Sign out was under "My trips".
  return createPortal(
    <div className="fixed inset-0 z-[1200] flex items-end" role="dialog" aria-label={label}>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="field-backdrop absolute inset-0 cursor-pointer border-0 bg-black/25"
      />
      <div className="field-sheet-up relative w-full rounded-t-[18px] border-t border-line bg-white px-[18px] pb-[max(26px,env(safe-area-inset-bottom))] pt-[18px]">
        {children}
      </div>
    </div>,
    document.body,
  )
}

/**
 * The list's top-level split.
 *
 * Underlined rather than filled pills: three filled pills are three buttons
 * competing with the screen's actual action, and the count beside each label
 * already answers "is there anything in there" without opening it. Equal
 * thirds, centred, so the row reads as one control across the width rather
 * than three words huddled at the left edge.
 */
export function FieldTabs<T extends string>({ value, onChange, tabs }: {
  value: T
  onChange: (v: T) => void
  tabs: { key: T; label: string; count: number }[]
}) {
  // One underline for the row, moved under whichever tab is on, rather than
  // one per tab switched on and off: the slide is what says "same list,
  // different slice".
  const list = useRef<HTMLDivElement>(null)
  const [bar, setBar] = useState<{ left: number; width: number } | null>(null)
  // Re-measured when the labels change width too: a count going from 9 to 10
  // moves every tab to its right.
  const shape = tabs.map((t) => `${t.label}${t.count}`).join('|')
  useLayoutEffect(() => {
    const el = list.current?.querySelector<HTMLElement>('[aria-selected="true"]')
    if (el) setBar({ left: el.offsetLeft, width: el.offsetWidth })
  }, [value, shape])

  return (
    <div ref={list} role="tablist" className="relative mx-[18px] mt-[16px] flex border-b border-line">
      {tabs.map((t) => {
        const on = t.key === value
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={on}
            aria-label={`${t.label}, ${t.count}`}
            onClick={() => onChange(t.key)}
            className={`relative min-w-0 flex-1 cursor-pointer whitespace-nowrap border-0 bg-transparent px-0 pb-[10px] pt-0 text-center text-[14px] font-semibold transition-colors ${
              on ? 'text-ink' : 'text-faint'
            }`}
          >
            {t.label}
            <span className={`ml-[5px] font-meta text-[12px] font-semibold transition-colors ${on ? 'text-mut' : 'text-faint'}`}>
              {t.count}
            </span>
          </button>
        )
      })}
      <span
        aria-hidden
        className="absolute -bottom-px h-[2px] rounded-[2px] bg-ink transition-[left,width] duration-200 ease-out motion-reduce:transition-none"
        style={bar ? { left: bar.left, width: bar.width } : { left: 0, width: 0 }}
      />
    </div>
  )
}

export function FieldBody({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`px-[18px] pt-[16px] ${className}`}>{children}</div>
}

/** The quiet heading over a run of rows. */
export function FieldSectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="m-0 mb-[10px] mt-[22px] font-meta text-[12px] font-semibold uppercase tracking-[.08em] text-mut first:mt-0">
      {children}
    </p>
  )
}

// ---- surfaces ---------------------------------------------------------------

export function Card({ children, lead, className = '' }: {
  children: ReactNode
  /** The one card that leads the screen - slightly lifted off the page. */
  lead?: boolean
  className?: string
}) {
  return (
    <div className={`mb-[12px] rounded-[14px] border bg-white p-[16px] ${
      lead ? 'border-[#dfe4e7] shadow-[0_2px_8px_rgba(16,24,32,.05)]' : 'border-line'
    } ${className}`}>
      {children}
    </div>
  )
}

/** A card that is only a list - the rows draw their own padding. */
export function CardList({ children }: { children: ReactNode }) {
  return <div className="field-list mb-[12px] overflow-hidden rounded-[14px] border border-line bg-white">{children}</div>
}

/** The state line above a card's title. Red is reserved for "now". */
export function Eyebrow({ children, tone = 'act' }: { children: ReactNode; tone?: 'act' | 'calm' }) {
  return (
    <span className={`inline-flex items-center gap-[6px] font-meta text-[11px] font-bold uppercase tracking-[.08em] ${
      tone === 'act' ? 'text-redtext' : 'text-sec'
    }`}>
      <span aria-hidden className={`h-[7px] w-[7px] rounded-full ${tone === 'act' ? 'bg-redtext' : 'bg-sec'}`} />
      {children}
    </span>
  )
}

/** A fact with an icon in front of it, the way a phone states a fact. */
export function IconRow({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="mt-[9px] flex items-center gap-[9px] text-[14px] text-lab first:mt-0">
      <span className="flex w-[17px] shrink-0 justify-center text-faint">{icon}</span>
      <span className="min-w-0">{children}</span>
    </div>
  )
}

/** A short state word. Quiet by default - this is a label, not an alarm. */
export function Pill({ text, tone = 'plain' }: { text: string; tone?: 'plain' | 'good' | 'watch' | 'act' }) {
  const cls = tone === 'good' ? 'bg-greenbadge text-greentext'
    : tone === 'watch' ? 'bg-amberbadge text-ambertext'
    : tone === 'act' ? 'bg-redbadge text-redtext'
    : 'bg-fill2 text-sec'
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-[9px] py-[3px] font-meta text-[11px] font-semibold ${cls}`}>
      {text}
    </span>
  )
}

/** What has to happen, in the card it belongs to. */
export function CardNote({ children, tone = 'act' }: { children: ReactNode; tone?: 'act' | 'calm' }) {
  return (
    <p className={`m-0 mt-[12px] rounded-[10px] px-[12px] py-[10px] text-[13px] leading-[1.4] ${
      tone === 'act' ? 'bg-redbadge font-semibold text-redtext' : 'bg-fill2 text-sec'
    }`}>
      {children}
    </p>
  )
}

/** The money figure a screen is about. */
export function BigFigure({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <>
      <Eyebrow tone="calm">{label}</Eyebrow>
      <p className="tnum m-0 mt-[6px] text-[34px] font-semibold leading-[1.05] tracking-[-0.025em]">{value}</p>
      {sub && <p className="m-0 mt-[7px] font-meta text-[13px] text-mut">{sub}</p>}
    </>
  )
}

// ---- rows -------------------------------------------------------------------

/** A tappable row: the press is acknowledged by a shade and a shrink. */
const press = 'cursor-pointer transition-[background-color,transform] duration-150 active:scale-[.985] active:bg-fill2 motion-reduce:transition-none'


/**
 * One item in a list.
 *
 * Anchored by its date rather than by an icon: every row here is a thing that
 * happened or is going to, and the day is what somebody scanning is matching
 * against. `need` is red and `note` is not - the difference between a payment
 * that is late and one that is simply coming.
 */
export function FieldRow({ day, title, meta, need, note, value, right, onOpen }: {
  /** An ISO date. Rendered as the row's left-hand anchor. */
  day?: string
  title: string
  meta?: ReactNode
  need?: ReactNode
  note?: ReactNode
  value?: ReactNode
  right?: ReactNode
  /** Omitted when there is nothing behind the row - a parked submission is not a
   *  record yet, and a chevron that opens nothing reads as a broken app. */
  onOpen?: () => void
}) {
  const d = day ? new Date(day) : null
  const inner = (
    <>
      {d && (
        <span className="w-[42px] shrink-0 text-center">
          <span className="block text-[17px] font-semibold leading-[1.1]">
            {String(d.getDate()).padStart(2, '0')}
          </span>
          <span className="mt-[1px] block font-meta text-[11px] font-semibold uppercase tracking-[.06em] text-faint">
            {d.toLocaleDateString(undefined, { month: 'short' })}
          </span>
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 text-[15px] font-semibold leading-[1.3]">{title}</span>
          {value && <span className="tnum shrink-0 text-[15px] font-semibold">{value}</span>}
        </span>
        {meta && <span className="mt-[3px] block font-meta text-[13px] text-mut">{meta}</span>}
        {need && <span className="mt-[5px] block font-meta text-[13px] font-semibold text-redtext">{need}</span>}
        {!need && note && <span className="mt-[5px] block font-meta text-[13px] text-sec">{note}</span>}
      </span>
      {right}
      {onOpen && <ChevronRight size={17} strokeWidth={2} className="shrink-0 self-center text-faint" />}
    </>
  )
  const cls = 'flex w-full items-start gap-3 border-b border-linesoft px-[16px] py-[14px] text-left last:border-b-0'
  return onOpen
    ? <button type="button" onClick={onOpen} className={`${cls} ${press} bg-transparent`}>{inner}</button>
    : <div className={cls}>{inner}</div>
}

/**
 * One item in a list, on one line.
 *
 * The name on the left, the figure on the right, and one short line under the
 * name saying when - a tag when it is urgent, plain text when it is not. The
 * sale list used to carry five pieces of text per row and read as prose; what
 * is not needed to decide whether to open the row belongs on the row's screen.
 */
export function CompactRow({ title, sub, value, valueSub, tone = 'plain', onOpen }: {
  title: string
  /** The one line under the name: a Pill, or plain text. */
  sub?: ReactNode
  value?: ReactNode
  /** A quieter line under the figure - "of ₱156,000", or a status Pill. */
  valueSub?: ReactNode
  /** Colours the figure. Red is only for money that is late. */
  tone?: 'plain' | 'act'
  onOpen?: () => void
}) {
  const inner = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold leading-[1.3]">{title}</span>
        {sub && <span className="mt-[4px] flex items-center gap-[6px] font-meta text-[13px] leading-none text-mut">{sub}</span>}
      </span>
      {(value || valueSub) && (
        <span className="shrink-0 text-right">
          {value && (
            <span className={`tnum block text-[15px] font-semibold leading-[1.3] ${tone === 'act' ? 'text-redtext' : ''}`}>
              {value}
            </span>
          )}
          {valueSub && <span className="mt-[4px] block font-meta text-[12px] leading-none text-mut">{valueSub}</span>}
        </span>
      )}
      {onOpen && <ChevronRight size={17} strokeWidth={2} className="shrink-0 text-faint" />}
    </>
  )
  const cls = 'flex w-full items-center gap-3 border-b border-linesoft px-[16px] py-[13px] text-left last:border-b-0'
  return onOpen
    ? <button type="button" onClick={onOpen} className={`${cls} ${press} bg-transparent`}>{inner}</button>
    : <div className={cls}>{inner}</div>
}

/**
 * The figures a screen is about, in one slim row.
 *
 * Three cells where the lead card was: the same numbers in a third of the
 * height, and the ones that used to need a tab change (overdue, pending) are
 * in view from the start. Values are abbreviated by the caller so a cell never
 * wraps at 390px.
 */
export function SummaryStrip({ cells }: {
  cells: { label: string; value: number; format: (n: number) => ReactNode; tone?: 'plain' | 'act' | 'mut' }[]
}) {
  return (
    <div className="mb-[12px] flex overflow-hidden rounded-[14px] border border-line bg-white">
      {cells.map((c) => <StripCell key={c.label} {...c} />)}
    </div>
  )
}

function StripCell({ label, value, format, tone }: {
  label: string; value: number; format: (n: number) => ReactNode; tone?: 'plain' | 'act' | 'mut'
}) {
  const shown = useCountUp(value)
  return (
    <div className="min-w-0 flex-1 border-l border-linesoft px-[14px] py-[12px] first:border-l-0">
      <p className="m-0 font-meta text-[11px] font-semibold uppercase leading-none tracking-[.07em] text-mut">{label}</p>
      <p className={`tnum m-0 mt-[6px] whitespace-nowrap text-[19px] font-semibold leading-[1.05] tracking-[-0.02em] ${
        tone === 'act' ? 'text-redtext' : tone === 'mut' ? 'font-medium text-mut' : ''
      }`}>
        {format(shown)}
      </p>
    </div>
  )
}

/** Whether to draw motion at all: a real browser, and nobody has asked for
 *  it to be reduced. False in jsdom, where there is no matchMedia and nothing
 *  to watch - and where a leaving screen kept for its exit would be a second
 *  copy of every element for the tests to trip over. */
export const motionOK = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' &&
  !window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * A figure that runs up to its value when it first appears or changes.
 *
 * Brief - 400ms, eased out - so the number is readable almost at once; the
 * motion only says "this was just worked out". Skipped under reduced motion
 * and wherever requestAnimationFrame is missing (tests), where the value is
 * simply shown.
 */
export function useCountUp(target: number, ms = 400): number {
  const [shown, setShown] = useState(target)
  const from = useRef(target)
  useEffect(() => {
    if (!motionOK() || typeof requestAnimationFrame !== 'function' || from.current === target) {
      from.current = target
      setShown(target)
      return
    }
    const start = performance.now()
    const begin = from.current
    let raf = 0
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms)
      const eased = 1 - (1 - t) ** 3
      setShown(begin + (target - begin) * eased)
      if (t < 1) raf = requestAnimationFrame(step)
      else from.current = target
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, ms])
  return shown
}

export function FieldEmpty({ children }: { children: ReactNode }) {
  return (
    <p className="m-0 rounded-[14px] border border-line bg-white px-[16px] py-8 text-center text-[14px] leading-[1.5] text-faint">
      {children}
    </p>
  )
}

// ---- a screen for one record -------------------------------------------------

/** The back control and the state of the thing you opened. */
export function SheetHeader({ back, pill, title, sub }: {
  back: () => void
  pill?: ReactNode
  title: string
  sub?: ReactNode
}) {
  // One row, like the list screens' header: the back control sits beside the
  // title, not on a line of its own above it, and the state pill takes the
  // right-hand corner where the list screens keep their buttons.
  return (
    <div className="flex items-center gap-[12px] px-[18px] pt-[16px]">
      <button
        type="button"
        onClick={back}
        aria-label="Back"
        className="flex h-[38px] w-[38px] shrink-0 cursor-pointer items-center justify-center rounded-full border border-line bg-white text-sec"
      >
        <ChevronLeft size={17} strokeWidth={2} />
      </button>
      <div className="min-w-0 flex-1">
        <h1 className="m-0 text-[22px] font-semibold leading-[1.2] tracking-[-0.02em]">{title}</h1>
        {sub && <p className="m-0 mt-[2px] truncate font-meta text-[13px] text-mut">{sub}</p>}
      </div>
      {pill && <span className="shrink-0">{pill}</span>}
    </div>
  )
}

/**
 * The bar that holds a screen's commit.
 *
 * Sticky rather than at the end of the scroll, and it can carry a summary line:
 * on the sale form the figure being committed stays on screen while the form is
 * filled in, instead of living below the fold from every field that changes it.
 */
/**
 * What is still missing before the button below can be pressed cleanly:
 * a warning mark and one small chip per gap, rather than a red sentence
 * that reads as an error when it is a to-do.
 */
export function GapChips({ items, tone = 'amber' }: { items: string[]; tone?: 'amber' | 'red' }) {
  if (items.length === 0) return null
  const chip = tone === 'amber' ? 'bg-amberbadge text-ambertext' : 'bg-redbadge text-redtext'
  return (
    <div className="flex flex-wrap items-center gap-[6px]" role="status" aria-label={`Still needs ${items.join(', ')}`}>
      <span className="mr-[2px] font-meta text-[11px] font-semibold uppercase tracking-[.07em] text-mut">Still needs</span>
      {items.map((g) => (
        <span key={g} className={`inline-flex h-[26px] items-center rounded-full px-[10px] font-meta text-[12px] font-semibold ${chip}`}>{g}</span>
      ))}
    </div>
  )
}

export function Dock({ summary, gap, children }: {
  summary?: { label: ReactNode; value: ReactNode }
  gap?: ReactNode
  children: ReactNode
}) {
  // While the keyboard is up the dock lets go and scrolls with the form:
  // stuck, it rode up on the keyboard and covered the field being typed in.
  const keyboard = useKeyboardOpen()
  return (
    // Sticks above the tab bar, not to the screen's bottom edge: the bar is
    // fixed over everything, and a dock stuck at 0 put Save under "My trips".
    <div className={`${keyboard ? 'static' : 'sticky bottom-[var(--field-bar-h,0px)]'} mt-[18px] border-t border-line bg-white px-[18px] pb-[16px] pt-[12px] [margin-inline:-18px]`}>
      {summary && (
        <div className="mb-[10px] flex items-baseline justify-between gap-3">
          <span className="font-meta text-[13px] text-mut">{summary.label}</span>
          <span className="tnum text-[20px] font-semibold">{summary.value}</span>
        </div>
      )}
      {gap && <div className="mb-[10px]">{gap}</div>}
      {children}
    </div>
  )
}

/** The full-width commit. 48px, because it is the thing the screen is for. */
export function Action({ children, onClick, disabled, tone = 'primary' }: {
  children: ReactNode
  onClick: () => void
  disabled?: boolean
  tone?: 'primary' | 'ghost'
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`mt-[8px] flex h-[48px] w-full cursor-pointer items-center justify-center rounded-[11px] text-[15px] font-semibold transition-[opacity,transform] duration-150 first:mt-0 active:scale-[.98] disabled:opacity-50 motion-reduce:transition-none ${
        tone === 'primary' ? 'border-0 bg-ink text-white' : 'border border-inputline bg-white text-lab'
      }`}
    >
      {children}
    </button>
  )
}

/**
 * Bottom right, under the thumb, and out of the way of the page title.
 *
 * Shrinks to its icon once the page has scrolled - the label has been read by
 * then, and a full pill over a list of amounts hides the one you are reading -
 * and grows back at the top.
 */
export function Fab({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  const scrolled = useScrolled(64)
  const keyboard = useKeyboardOpen()
  // Into <body>, like BottomSheet: inside the page's fade-in it was fixed to
  // the page's box, not the screen, and scrolled away with the list. Gone
  // while the keyboard is up - it would sit on top of it.
  if (keyboard) return null
  return createPortal(
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="fixed bottom-[calc(16px+var(--field-bar-h,0px))] right-[16px] z-[600] flex h-[46px] cursor-pointer items-center rounded-full border-0 bg-ink text-[15px] font-semibold text-white shadow-[0_6px_18px_rgba(0,0,0,.22)] transition-[padding,transform] duration-200 ease-out active:scale-[.96] motion-reduce:transition-none"
      style={{ paddingInline: scrolled ? 14 : 20 }}
    >
      <span className="flex shrink-0 items-center">{icon}</span>
      <span
        aria-hidden
        className="overflow-hidden whitespace-nowrap transition-[max-width,opacity,margin] duration-200 ease-out motion-reduce:transition-none"
        style={{ maxWidth: scrolled ? 0 : 140, opacity: scrolled ? 0 : 1, marginLeft: scrolled ? 0 : 7 }}
      >
        {label}
      </span>
    </button>,
    document.body,
  )
}

/** Whether the page is scrolled past `threshold`. Passive, and only re-renders
 *  on the crossing, not on every scroll event. */
/**
 * Whether the on-screen keyboard is (almost certainly) up.
 *
 * A phone keyboard shrinks the visual viewport, and everything pinned to
 * its bottom - the tab bar, a sticky dock, the floating button - rides up
 * on top of the keyboard and sits between the person and the field they
 * are typing into. There is no keyboard event to listen for, so this reads
 * the two things that do happen: a text control takes focus, and the visual
 * viewport gets a lot shorter than the window. Either alone misfires (a
 * hardware keyboard, an in-page scroll); both together is the keyboard.
 */
export function useKeyboardOpen(): boolean {
  const [focused, setFocused] = useState(false)
  const [shrunk, setShrunk] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const typing = (el: Element | null) => {
      if (!el) return false
      const tag = el.tagName
      if (tag === 'TEXTAREA' || (el as HTMLElement).isContentEditable) return true
      if (tag !== 'INPUT') return false
      const type = (el as HTMLInputElement).type
      return !['checkbox', 'radio', 'button', 'submit', 'file', 'range', 'color'].includes(type)
    }
    const onFocus = () => setFocused(typing(document.activeElement))
    const onBlur = () => setTimeout(() => setFocused(typing(document.activeElement)), 50)
    document.addEventListener('focusin', onFocus)
    document.addEventListener('focusout', onBlur)
    const vv = window.visualViewport
    const measure = () => setShrunk(!!vv && vv.height < window.innerHeight * 0.8)
    measure()
    vv?.addEventListener('resize', measure)
    return () => {
      document.removeEventListener('focusin', onFocus)
      document.removeEventListener('focusout', onBlur)
      vv?.removeEventListener('resize', measure)
    }
  }, [])
  // Android's viewport shrinks; iOS Safari's visual viewport does too but
  // reports late, so focus on a text control counts on its own there.
  return focused && (shrunk || /iPhone|iPad|iPod/.test(navigator.userAgent))
}

function useScrolled(threshold: number): boolean {
  const [on, setOn] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const read = () => setOn(window.scrollY > threshold)
    read()
    window.addEventListener('scroll', read, { passive: true })
    return () => window.removeEventListener('scroll', read)
  }, [threshold])
  return on
}

// ---- screens ----------------------------------------------------------------

/**
 * One screen at a time, with the move between them drawn.
 *
 * A sheet opened from a list slides in from the right; going back, it slides
 * out the same way over the list, which fades in beneath. The direction comes
 * from `depth` - a bigger number is further in - so the caller says only what
 * is on screen and how deep it is. The leaving screen is kept for the length
 * of its exit, laid over the top and inert, then dropped.
 */
export function ScreenStack({ screen, depth, children }: {
  /** Identifies the screen. A change is what animates. */
  screen: string
  depth: number
  children: ReactNode
}) {
  const [leaving, setLeaving] = useState<{ node: ReactNode; sheet: boolean } | null>(null)
  const [enter, setEnter] = useState<'sheet' | 'list' | null>(null)
  const prev = useRef<{ screen: string; depth: number; node: ReactNode }>({ screen, depth, node: children })

  useLayoutEffect(() => {
    const was = prev.current
    prev.current = { screen, depth, node: children }
    if (was.screen === screen) return
    const forward = depth > was.depth
    // The old screen leaves as what it was; the new one arrives as what it is.
    setLeaving(motionOK() ? { node: was.node, sheet: !forward } : null)
    setEnter(forward ? 'sheet' : 'list')
    window.scrollTo?.({ top: 0 })
    const t = setTimeout(() => { setLeaving(null); setEnter(null) }, 240)
    return () => clearTimeout(t)
    // Only a change of screen is a move; `children` and `depth` are read
    // through the ref so re-renders of the same screen do not replay it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen])

  return (
    <div className="relative">
      <div key={screen} className={enter === 'sheet' ? 'field-enter-sheet' : enter === 'list' ? 'field-enter-list' : undefined}>
        {children}
      </div>
      {leaving && (
        <div
          aria-hidden
          className={`pointer-events-none absolute inset-x-0 top-0 ${leaving.sheet ? 'field-leave-sheet' : 'field-leave-list'}`}
        >
          {leaving.node}
        </div>
      )}
    </div>
  )
}

// ---- the stage timeline ------------------------------------------------------

/**
 * Where a record has got to, and what it wants next.
 *
 * The trip sheet used to be four stacked panels of equal weight, which is a
 * report about a trip rather than a screen for working one. A timeline says the
 * same thing in the shape the work actually has: what is finished collapses to
 * a line with a tick and the name of whoever did it, the stage being worked on
 * is open with its fields in it, and what is still ahead is grey and quiet.
 */
export function Timeline({ children }: { children: ReactNode }) {
  return <div className="relative pl-[30px]">{children}</div>
}

export function Stage({ state, title, meta, last, children }: {
  state: 'done' | 'now' | 'later'
  title: string
  meta?: ReactNode
  /** Draws no rail below it. Passed rather than derived: `last:` would test the
   *  rail's own position among its siblings, not the stage's. */
  last?: boolean
  children?: ReactNode
}) {
  return (
    <section aria-label={title} className="relative pb-[18px] last:pb-0">
      {/* The rail between dots, absent on the last stage so the line does not
          trail off the bottom of the card. */}
      {!last && <span aria-hidden className="absolute -left-[22px] bottom-[-2px] top-[20px] w-[2px] bg-linesoft" />}
      <span
        aria-hidden
        className={`absolute -left-[30px] top-[1px] flex h-[18px] w-[18px] items-center justify-center rounded-full border-2 bg-white ${
          state === 'done' ? 'border-greentext bg-greentext text-white'
            : state === 'now' ? 'border-ink shadow-[0_0_0_4px_rgba(20,24,27,.09)]'
            : 'border-inputline'
        }`}
      >
        {state === 'done' && <Check size={11} strokeWidth={3} />}
        {state === 'now' && <span className="h-[7px] w-[7px] rounded-full bg-ink" />}
      </span>
      <p className={`m-0 text-[15px] font-semibold leading-[1.2] ${state === 'later' ? 'text-faint' : 'text-ink'}`}>
        {title}
      </p>
      {meta && <p className="m-0 mt-[2px] font-meta text-[13px] text-mut">{meta}</p>}
      {children && <div className="mt-[12px]">{children}</div>}
    </section>
  )
}

/** How far through a count of things this stage is. */
export function StageProgress({ done, total }: { done: number; total: number }) {
  return (
    <div className="mt-[10px] h-[5px] overflow-hidden rounded-full bg-fill2">
      <span
        className="block h-full rounded-full bg-ink transition-[width]"
        style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }}
      />
    </div>
  )
}

// ---- controls ---------------------------------------------------------------

const ctlBase =
  'block w-full rounded-[11px] border border-inputline bg-white px-[14px] text-[16px] text-ink ' +
  'outline-none transition-[border-color] focus:border-ink disabled:bg-fill2 disabled:text-mut'

/** 48px and 16px. See the note at the top of this file. */
const ctl = `${ctlBase} h-[48px]`

export function FieldInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className = '', ...rest } = props
  return <input {...rest} className={`${ctl} ${className}`} />
}

const caret =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%2378828b' stroke-width='1.6' stroke-linecap='round'/%3E%3C/svg%3E\")"

export function FieldSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const { className = '', style, ...rest } = props
  return (
    <select
      {...rest}
      style={{ backgroundImage: caret, ...style }}
      className={`${ctl} appearance-none bg-[length:10px] bg-[right_16px_center] bg-no-repeat pr-[38px] ${className}`}
    />
  )
}

export function FieldField({ label, hint, error, children }: {
  label: string
  hint?: ReactNode
  error?: string
  children: ReactNode
}) {
  return (
    <label className="mb-[14px] block last:mb-0">
      <span className="mb-[6px] block font-meta text-[13px] font-semibold text-lab">{label}</span>
      <span className={error ? 'block [&_input]:border-redf [&_select]:border-redf' : 'block'}>{children}</span>
      {error
        ? <span className="mt-[6px] block font-meta text-[12px] font-semibold text-redtext">{error}</span>
        : hint && <span className="mt-[6px] block font-meta text-[12px] text-faint">{hint}</span>}
    </label>
  )
}

/** Two or three choices, readable without being opened. */
export function FieldChoice<T extends string>({ value, onChange, options }: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
}) {
  return (
    <span className="flex gap-[8px]">
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={`h-[46px] flex-1 cursor-pointer rounded-[11px] border text-[14px] transition-[color,background-color,border-color,transform] duration-150 active:scale-[.97] motion-reduce:transition-none ${
              on ? 'border-ink bg-ink font-semibold text-white' : 'border-inputline bg-white text-lab'
            }`}
          >
            {o.label}
          </button>
        )
      })}
    </span>
  )
}

/** A checklist line. 24px box, 12px gap, a whole row as the target. */
export function FieldCheck({ checked, onChange, disabled, children }: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <label className="flex cursor-pointer items-center gap-[12px] border-b border-linesoft px-[14px] py-[12px] text-[14px] leading-[1.35] last:border-b-0">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="field-tick h-[24px] w-[24px] shrink-0 cursor-pointer rounded-[7px] accent-ink"
      />
      {children}
    </label>
  )
}

// ---- paging ------------------------------------------------------------------

/**
 * How much of a long list is on screen, and the button that extends it.
 *
 * Page numbers need a footer, a page size and somewhere to put "of 14" - all of
 * which cost more at 390px than they return. A growing window keeps the thing
 * you were reading where it was and never leaves an empty page at the end.
 */
export function useFieldWindow<T>(rows: T[], step = 15) {
  const [shown, setShown] = useState(step)
  const visible = rows.slice(0, shown)
  const rest = rows.length - visible.length
  const more = rest > 0
    ? (
      <button
        type="button"
        onClick={() => setShown((n) => n + step)}
        className="mt-[10px] h-[44px] w-full cursor-pointer rounded-[11px] border border-inputline bg-white font-meta text-[14px] font-semibold text-lab transition-transform duration-150 active:scale-[.98] motion-reduce:transition-none"
      >
        Show {Math.min(step, rest)} more · {rest} remaining
      </button>
    )
    : null
  return { visible, more }
}
