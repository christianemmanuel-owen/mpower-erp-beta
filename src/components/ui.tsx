import {
  Children, cloneElement, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState,
  type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { usePaged } from '../lib/paging'
import { Check, ChevronRight, CircleX, PackageX, Pencil, RotateCcw, Trash2, X, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import { createPortal } from 'react-dom'
import type { ReactElement } from 'react'
import type { SortState } from '../lib/sort'

/**
 * Status treatment, MPower Diesel Trading palette.
 *
 * A pill is reserved for the two states that need a person to do something:
 * `watch` (amber) and `act` (red). Everything else - confirmed, delivered,
 * received, fulfilled, scheduled - renders as plain muted text with no
 * background, because a finished thing needs nothing from you and a filled
 * shape on every row is what made the old screens read as busy.
 */
type Tone = 'watch' | 'act' | 'plain'

const chipTone: Record<string, Tone> = {
  // Act now - money promised and refused, or a commitment already missed.
  overdue: 'act',
  failed: 'act',
  bounced: 'act',
  absent: 'act',
  poor: 'act',
  // Watch it - in flight, or waiting on someone.
  ordered: 'watch',
  pending: 'watch',
  // Banked, not yet money - waiting on the bank is waiting on someone.
  deposited: 'watch',
  loading: 'watch',
  returned: 'watch',
  half_day: 'watch',
  no_rate: 'watch',
  watch: 'watch',
  // Generic keys, so a caller can say which tone it means rather than borrowing
  // an unrelated status word - "watch" already worked this way and "act" did
  // not, so anything urgent that was not literally an absence was reaching for
  // the wrong colour or settling for amber.
  act: 'act',
  special_nonworking: 'watch',
}

const toneCls: Record<Exclude<Tone, 'plain'>, string> = {
  watch: 'bg-amberbadge text-ambertext',
  act: 'bg-redbadge text-redtext',
}

export function Chip({ status, text }: { status: string; text: string }) {
  const tone = chipTone[status] ?? 'plain'
  if (tone === 'plain') {
    return <span className="whitespace-nowrap font-meta text-[12px] text-mut">{text}</span>
  }
  return (
    <span className={`inline-flex whitespace-nowrap rounded-[4px] px-[7px] py-[2px] font-meta text-[10px] font-semibold uppercase tracking-[.09em] ${toneCls[tone]}`}>
      {text}
    </span>
  )
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="m-0 font-meta text-[10px] font-semibold uppercase tracking-[.09em] text-mut">{children}</p>
}

export function Card({ children, className, delay }: { children: ReactNode; className?: string; delay?: number }) {
  // `delay` is still accepted so no caller has to change, but card-level
  // entrance animation is gone - a whole screen fading up on every navigation
  // is noise. See the `.rise` no-op in index.css.
  void delay
  return (
    <div className={`fade-only overflow-hidden rounded-[8px] border border-line bg-white ${className ?? ''}`}>
      {children}
    </div>
  )
}

/** Horizontal gauge bar with a measured-in fill. */
export function Gauge({ pct, color, height = 5, delay = 150 }: { pct: number; color: string; height?: number; delay?: number }) {
  return (
    <div className="overflow-hidden rounded-[3px] bg-fill2" style={{ height }}>
      <div className={`grow ${color}`} style={{ height, width: `${Math.min(Math.max(pct, 0), 100)}%`, animationDelay: `${delay}ms` }} />
    </div>
  )
}

/**
 * Headline figures in a white band split by hairlines.
 *
 * This used to be an ink-coloured strip, which made it the loudest object on a
 * screen full of numbers that matter more. Same props, so no caller changed.
 */
export function KpiStrip({ items, delay }: {
  items: {
    label: ReactNode
    value: ReactNode
    sub?: ReactNode
    /** Where the figure comes from; the cell becomes a link there. */
    to?: string
    /** What the figure counts, as a tip in the cell's top-right corner. */
    tip?: { label: string; body: ReactNode }
  }[]
  delay?: number
}) {
  void delay
  return (
    // Wraps rather than squeezes. Six KPIs in a narrow column gave each cell
    // about 90px of room for a 20px figure like "1,250,000 L", which does not
    // break - so the last one ran out past the strip's own border. auto-fit
    // drops to fewer columns and starts a second row instead. The separators
    // are hairline gaps over a ruled ground rather than a left border per cell,
    // because a left border on the first cell of a second row is a stray line.
    <div
      className="tnum fade-only grid gap-px overflow-hidden rounded-[8px] border border-line bg-linesoft"
      style={{ gridTemplateColumns: `repeat(auto-fit, minmax(150px, 1fr))` }}
    >
      {items.map((item, i) => {
        const body = (
          <>
            <p className="m-0 flex items-center gap-[5px] font-meta text-[10px] font-semibold uppercase tracking-[.09em] text-faint">
              <span className="min-w-0 truncate">{item.label}</span>
              <span className="ml-auto flex shrink-0 items-center gap-[4px]">
                {item.to && <ChevronRight size={11} strokeWidth={2.2} className="text-faint opacity-0 transition-opacity group-hover:opacity-100" />}
                {item.tip && (
                  // Stops the click reaching the cell's link: opening the note
                  // should not also open the module.
                  <span onClick={(e) => { e.preventDefault(); e.stopPropagation() }}>
                    <InfoTip label={item.tip.label}>{item.tip.body}</InfoTip>
                  </span>
                )}
              </span>
            </p>
            <p className="m-0 mt-[5px] text-[20px] font-semibold leading-[1.2] tracking-[-0.02em]">{item.value}</p>
            {item.sub && <p className="m-0 mt-[3px] font-meta text-[12px] text-mut">{item.sub}</p>}
          </>
        )
        // A figure that comes from a module opens that module. Drawn as the
        // same cell, with a chevron on hover, rather than as a separate "Open"
        // control beside a number that already says where it is from.
        return item.to ? (
          <Link key={i} to={item.to} className="group min-w-0 bg-white px-4 py-3 text-inherit no-underline transition-colors hover:bg-paper">
            {body}
          </Link>
        ) : (
          <div key={i} className="min-w-0 bg-white px-4 py-3">{body}</div>
        )
      })}
    </div>
  )
}

/**
 * The one form surface in the app.
 *
 * It was called SlideOver and has been a centred modal for some time, which
 * made every call site read as though a panel slid in from the edge. The name
 * is the behaviour now.
 *
 * The things a dialog owes a keyboard: Escape closes it, focus moves inside it
 * on open and returns to whatever opened it on close, and Tab cycles within it
 * rather than wandering onto the page behind. None of that was here, so every
 * form in the app was a trap for anyone not using a mouse. The page behind also
 * scrolled under the overlay, which made a long form feel broken on a laptop.
 */
/**
 * One page of a stepped dialog. `title` names it in the progress header.
 *
 * A step is a plain object rather than a component so the dialog can render the
 * header, count the steps and know which is last without any caller having to
 * tell it twice.
 */
export interface DialogStep {
  title: string
  content: ReactNode
}

/**
 * The width of a three-panel dialog - nav, form, rail.
 *
 * One number rather than a value per caller, so the seat, role, customer,
 * employee, sale, purchase and approval editors are the same size on screen
 * and open in the same place. 1160 leaves the middle column about 650px once
 * the nav (176) and rail (296) have theirs, which is enough for the
 * installment plan to sit on one line, and still clears a 1280px display with
 * the 24px page gutter on each side.
 */
export const WIDE_DIALOG = 1160

export function Dialog({ open, title, subtitle, aside, rail, nav, onClose, children, steps, footer, width = 640, flush = false }: {
  open: boolean
  title: string
  /** The specifics, under the title. The title says what this is; this says
   * which one. */
  subtitle?: ReactNode
  /** No body padding and no body scroll: the children fill the panel and
   *  manage their own scrolling - a map beside a list, say. */
  flush?: boolean
  /**
   * Provenance, on the right of the header - who and when, typically.
   *
   * It belongs here rather than in the body because it is true of the whole
   * dialog: on a stepped one it would otherwise sit on page one and be gone
   * for the four pages where the decision actually gets made.
   */
  aside?: ReactNode
  /**
   * A column beside the body, for the figures a form is really about.
   *
   * On the sale and purchase forms the derived numbers - price per litre, what
   * the depot holds after this, whether the payment plan adds up to the total -
   * used to be scattered: one in the footer beside Cancel, one as a banner in
   * the middle of the scroll, one buried inside the installment editor. You
   * typed a total at the top and checked it at the bottom. They belong together
   * and in view, which is what this column is.
   */
  rail?: ReactNode
  /**
   * A column on the left listing the form's parts, so a long form can be
   * navigated rather than only scrolled. See FormNav.
   */
  nav?: ReactNode
  onClose: () => void
  children?: ReactNode
  /**
   * Split the body into pages. When given, the dialog draws a progress header
   * and Back/Next, and `footer` appears only on the last step - a long form
   * that shows Approve on page one invites deciding before reading.
   *
   * `children` still renders above the step body, for anything that belongs to
   * the whole dialog rather than one page of it.
   */
  steps?: DialogStep[]
  footer?: ReactNode
  width?: number
}) {
  const panel = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const [step, setStep] = useState(0)

  /**
   * Hold the panel's height still.
   *
   * A dialog sized to its content resizes whenever the content changes, and in
   * these two families it changes constantly: a navigated form collapses and
   * expands its sections, a stepped one moves between pages of different
   * lengths. Every resize re-centres the panel, so the whole form slides under
   * the cursor and the footer buttons move out from under a click that was
   * already on its way. Short dialogs - a confirm, a two-field form - still fit
   * themselves, because a 700px-tall box around two fields is its own problem.
   */
  const steady = Boolean(nav || steps || flush)

  /**
   * Held in a ref so the setup effect below can depend on `open` alone.
   *
   * It used to list `onClose` in its deps, and almost every caller passes an
   * inline arrow - `onClose={() => setFormOpen(false)}` - which is a new
   * function on every render. So every keystroke in a dialog form re-ran the
   * whole effect: it tore down, restored focus to the opener, then set focus to
   * the first non-button control again. Typing one character into any field but
   * the first threw the caret back to the first field. New seat was where it
   * showed, but it was every dialog in the app with a form in it.
   */
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose })

  // A dialog reopened on a different record must not resume on page three of
  // the last one.
  useEffect(() => { if (!open) setStep(0) }, [open])

  useEffect(() => {
    if (!open) return

    // Where focus came from, so it can go back. Losing it to <body> after a
    // dialog closes means the next Tab starts from the top of the page.
    const opener = document.activeElement as HTMLElement | null
    const scrollLocked = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const focusable = () =>
      Array.from(
        panel.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => !el.hasAttribute('hidden') && el.getAttribute('aria-hidden') !== 'true')

    // Prefer the first real control over the close button, so opening a form
    // puts the caret where someone is about to type.
    const first = focusable()
    const target = first.find((el) => el.tagName !== 'BUTTON') ?? first[0] ?? panel.current
    target?.focus()

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        closeRef.current()
        return
      }
      if (e.key !== 'Tab') return
      const items = focusable()
      if (items.length === 0) return
      const firstEl = items[0]
      const lastEl = items[items.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === firstEl || !panel.current?.contains(active))) {
        e.preventDefault()
        lastEl.focus()
      } else if (!e.shiftKey && active === lastEl) {
        e.preventDefault()
        firstEl.focus()
      }
    }

    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.body.style.overflow = scrollLocked
      opener?.focus?.()
    }
    // `open` only. See closeRef above - anything else here re-runs the focus
    // and scroll-lock setup on every render of every caller.
  }, [open])

  if (!open) return null
  // Rendered via a portal straight onto <body> - not just wherever the caller happens to sit
  // in the tree. Any non-none transform on an ancestor creates a new containing block for
  // position:fixed descendants, so the dark overlay and the dialog itself would end up
  // clipped to that ancestor's box instead of covering - and centering in - the whole screen.
  return createPortal(
    <div className="fixed inset-0 z-[1200] flex items-center justify-center p-6">
      <div className="dlg-veil absolute inset-0 bg-ink/40" onClick={onClose} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`dlg-panel relative flex ${flush ? 'h-[min(85vh,680px)]' : steady ? 'h-[85vh]' : 'max-h-[85vh]'} w-full flex-col rounded-[8px] border border-line bg-white shadow-[0_20px_60px_rgba(20,24,27,.22)]`}
        style={{ maxWidth: width, animation: 'popIn .16s ease both' }}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-[13px]">
          <div className="min-w-0">
            <h2 id={titleId} className="m-0 text-[15px] font-semibold leading-[1.2] tracking-[-0.01em]">{title}</h2>
            {subtitle && (
              <p className="m-0 mt-[3px] truncate font-meta text-[12px] leading-[1.3] text-mut">{subtitle}</p>
            )}
          </div>
          {aside && <div className="ml-auto shrink-0 text-right">{aside}</div>}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-[26px] w-[26px] shrink-0 cursor-pointer items-center justify-center rounded-[6px] border-0 bg-transparent text-mut transition-colors hover:bg-fill2 hover:text-ink"
          >
            <X size={15} strokeWidth={2} />
          </button>
        </div>
        {steps && steps.length > 1 && (
          <ol className="m-0 flex list-none items-center justify-center gap-1 border-b border-linesoft bg-paper px-5 py-[10px]">
            {steps.map((s, i) => {
              const done = i < step
              const here = i === step
              return (
                <li key={s.title} className="flex items-center gap-1">
                  {i > 0 && <span aria-hidden className="mx-[6px] h-px w-[14px] bg-inputline" />}
                  <button
                    type="button"
                    // Back is always allowed; forward is not, so a reader cannot
                    // skip to the end and decide on a page they never opened.
                    onClick={() => { if (i <= step) setStep(i) }}
                    disabled={i > step}
                    aria-current={here ? 'step' : undefined}
                    className={`cursor-pointer rounded-[6px] border-0 bg-transparent px-[6px] py-[2px] font-meta text-[12px] transition-colors ${
                      here ? 'font-semibold text-ink'
                        : done ? 'text-sec hover:text-ink'
                        : 'cursor-default text-faint'
                    }`}
                  >
                    {s.title}
                  </button>
                </li>
              )
            })}
          </ol>
        )}

        <div className="flex min-h-0 flex-1">
          {nav && (
            <nav className="w-[176px] shrink-0 overflow-y-auto border-r border-linesoft bg-paper px-[10px] py-[14px]">
              {nav}
            </nav>
          )}
          {/* Named so FormNav can find the scroll container it has to measure
              against - the sections scroll inside this, not inside the page. */}
          <div data-dialog-body className={`min-w-0 flex-1 ${flush ? 'flex overflow-hidden' : 'overflow-y-auto px-5 py-[18px]'}`}>
            {children}
            {steps?.[step]?.content}
          </div>
          {rail && (
            // Scrolls on its own so a long form does not drag the totals off
            // the top of the screen - the point of them is being in view.
            <aside className="w-[296px] shrink-0 overflow-y-auto border-l border-linesoft bg-paper px-[18px] py-[18px]">
              {rail}
            </aside>
          )}
        </div>

        {(footer || (steps && steps.length > 1)) && (
          // Actions right, which is where a dialog's commit belongs and where
          // the eye lands after reading a form. Back is navigation rather than
          // an action, so it keeps the left edge.
          <div className="flex items-center justify-end gap-2 border-t border-line bg-paper px-5 py-3">
            {steps && steps.length > 1 && step > 0 && (
              <span className="mr-auto">
                <GhostButton onClick={() => setStep((n) => n - 1)}>Back</GhostButton>
              </span>
            )}
            {/* The dialog's real actions wait for the last page. */}
            {footer && (!steps || steps.length <= 1 || step === steps.length - 1) && footer}
            {steps && steps.length > 1 && step < steps.length - 1 && (
              <PrimaryButton onClick={() => setStep((n) => Math.min(n + 1, steps.length - 1))}>Next</PrimaryButton>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

/**
 * The heading over a group of fields.
 *
 * The hierarchy used to run backwards: a section heading was 10px and the field
 * labels it grouped were 13px semibold, so the thing organising five fields was
 * the quietest object on the form and each label shouted over it. The heading
 * is stronger now and, from the second one on, carries the rule that actually
 * separates one group from the next - space alone was not doing it inside a
 * dense two-column grid.
 */
/**
 * An on/off control, for a setting that takes effect the moment it is flipped.
 *
 * The app had no such thing, so a warning level was switched with a teal
 * "TURN OFF" text button - which reads as a link, states the action rather than
 * the state, and left you deducing the current state from the label's opposite.
 * A switch shows the state and takes one click to change it.
 *
 * A real checkbox underneath, so it is reachable by keyboard and announced as a
 * switch. The track is ink when on: this is a setting, not a status, and the
 * accent belongs to links.
 */
export function Switch({ checked, onChange, label, text, disabled }: {
  checked: boolean
  onChange: (next: boolean) => void
  /** Read out by screen readers. Also the visible text when `text` is omitted
   *  and the switch stands alone in a labelled column. */
  label: string
  /**
   * Visible text beside the switch.
   *
   * A switch in a table needs none - the column header says what it is - but a
   * switch in a form is a setting with a name, and four bare toggles under a
   * grid of text fields say nothing at all about what they turn off.
   */
  text?: ReactNode
  disabled?: boolean
}) {
  const track = (
    <span
      className={`relative inline-flex h-[18px] w-[30px] shrink-0 items-center rounded-full transition-colors ${
        checked ? 'bg-ink' : 'bg-inputline'
      }`}
    >
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        checked={checked}
        disabled={disabled}
        // Guarded as well as disabled. The attribute stops a real click, but a
        // programmatic one still reaches the handler, and a switch that cannot
        // be flipped should not report a change under any route.
        onChange={(e) => { if (!disabled) onChange(e.target.checked) }}
        className="peer absolute h-full w-full cursor-[inherit] opacity-0"
      />
      <span
        aria-hidden
        className={`pointer-events-none ml-[2px] block h-[14px] w-[14px] rounded-full bg-white shadow-[0_1px_2px_rgba(20,24,27,.3)] transition-transform peer-focus-visible:ring-2 peer-focus-visible:ring-ink/30 ${
          checked ? 'translate-x-[12px]' : 'translate-x-0'
        }`}
      />
    </span>
  )

  return (
    <label
      title={text ? undefined : label}
      className={`inline-flex items-center gap-[9px] ${disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}`}
    >
      {track}
      {text && <span className="text-[13px] text-lab">{text}</span>}
    </label>
  )
}

/**
 * The left-hand list of a settings page: sections, or record types.
 *
 * Admin and HR setup each grew their own - 14px radii, 9px buttons, an active
 * state filled solid ink and reversed to white text, all of which appear
 * nowhere else in the app. This is the same shape the form nav uses (a white
 * chip on the paper ground), so the two settings pages stop looking like a
 * different product.
 */
export function PanelNav<T extends string>({ items, active, onSelect, note }: {
  items: readonly { key: T; title: string; count?: ReactNode }[]
  active: T
  onSelect: (key: T) => void
  /** A sentence under the list - what this page is for, or who may use it. */
  note?: ReactNode
}) {
  return (
    <nav className="rounded-[8px] border border-line bg-paper p-[6px]">
      {items.map((item) => {
        const on = item.key === active
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onSelect(item.key)}
            aria-current={on ? 'page' : undefined}
            className={`flex w-full cursor-pointer items-center gap-2 rounded-[6px] border-0 px-[10px] py-[7px] text-left font-meta text-[12px] transition-colors ${
              on
                ? 'bg-white font-semibold text-ink shadow-[inset_0_0_0_1px_var(--color-line)]'
                : 'bg-transparent text-sec hover:text-ink'
            }`}
          >
            <span className="min-w-0 flex-1 truncate">{item.title}</span>
            {item.count !== undefined && (
              <span className={`tnum shrink-0 text-[12px] ${on ? 'text-mut' : 'text-faint'}`}>{item.count}</span>
            )}
          </button>
        )
      })}
      {note && (
        <p className="m-0 mt-[6px] border-t border-linesoft px-[10px] pt-[10px] font-meta text-[12px] leading-[1.5] text-faint">
          {note}
        </p>
      )}
    </nav>
  )
}

export function FormSection({ children, first, id, right }: {
  children: ReactNode
  first?: boolean
  id?: string
  /**
   * Something that belongs to the whole section - a "same as office" copy, a
   * tip - on the right of its heading.
   *
   * Callers used to wrap the heading and their control in a flex span, which
   * put the section's top rule around the heading only: a two-inch line above
   * a full-width section. Here the rule stays on the row.
   */
  right?: ReactNode
}) {
  return (
    <div
      id={id}
      // scroll-mt so a jumped-to heading lands below the body's top padding
      // rather than flush against the edge of the scroll box.
      className={`flex scroll-mt-[18px] items-center gap-2 font-meta text-[11px] font-semibold uppercase tracking-[.09em] text-sec ${
        first ? 'mb-[12px] mt-0' : 'mb-[12px] mt-6 border-t border-linesoft pt-[18px]'
      }`}
    >
      <span className="min-w-0">{children}</span>
      {right && <span className="ml-auto shrink-0">{right}</span>}
    </div>
  )
}

/**
 * One labelled control.
 *
 * This used to be a <label> wrapped around whatever it was given. A label with
 * no `for` attaches to the first labelable element inside it, so a Field
 * holding a row of toggle buttons made the first button announce itself as the
 * whole legend plus every other button's text - which is exactly what happened
 * to the announcement audience picker. The label is explicit now: a single
 * control gets an id and `htmlFor`, and anything else is a labelled group. The
 * footgun is gone rather than documented.
 */
export function Field({ label, children, span2, hint, error, optional, hideLabel }: {
  label: string
  children: ReactNode
  span2?: boolean
  hint?: string
  /**
   * Keep the label for screen readers but don't draw it.
   *
   * For the single-control section whose heading already IS the label - a step
   * titled "Reason" holding one reason box. Printing the word twice, once as a
   * heading and again five pixels below it, reads as a mistake.
   */
  hideLabel?: boolean
  /** Says "optional" at the label's right end, so the blanks that may stay
   *  blank are told apart from the ones that may not. */
  optional?: boolean
  /**
   * What is wrong with this field, said here rather than in a banner.
   *
   * The forms used to check everything on Save and return at the first failure,
   * so you fixed one problem to be told about the next. Shown per field, the
   * whole list is visible at once and each message sits on the control it is
   * about.
   */
  error?: string
}) {
  const id = useId()
  const hintId = `${id}-hint`
  const errId = `${id}-err`
  const only = Children.count(children) === 1 ? Children.only(children) : null
  // A single child ELEMENT is not the same as a single CONTROL: a <span>
  // wrapping a row of toggle buttons is one element too, and pointing htmlFor
  // at it would label nothing. Only the things a label can actually attach to
  // are treated as the field's control; everything else is a labelled group.
  type Labelable = { id?: string; 'aria-describedby'?: string }
  const isControl =
    isValidElement<Labelable>(only) &&
    (only.type === Input || only.type === Select || only.type === Textarea ||
      (typeof only.type === 'string' && ['input', 'select', 'textarea'].includes(only.type)))
  const single = isControl ? (only as ReactElement<Labelable>) : null

  const describedBy = [error ? errId : null, hint ? hintId : null].filter(Boolean).join(' ')
  const labelled = single
    ? cloneElement(single, {
        id: single.props.id ?? id,
        'aria-describedby': describedBy || single.props['aria-describedby'],
        ...(error ? { 'aria-invalid': true } : {}),
      })
    : children

  return (
    <div className={span2 ? 'col-span-2' : ''}>
      {/* 12px meta, not 13px semibold body. A label was the same size as the
          value inside the control and heavier than it, so a filled form read as
          a list of labels with data attached rather than the other way round. */}
      {single ? (
        <label htmlFor={single.props.id ?? id} className={hideLabel ? 'sr-only' : LABEL}>
          {label}{!hideLabel && optional && <Optional />}
        </label>
      ) : (
        <span id={`${id}-label`} className={hideLabel ? 'sr-only' : LABEL}>
          {label}{!hideLabel && optional && <Optional />}
        </span>
      )}
      <div className={error ? '[&_input]:border-redf [&_select]:border-redf [&_textarea]:border-redf' : ''}>
        {single ? labelled : <div role="group" aria-labelledby={`${id}-label`}>{children}</div>}
      </div>
      {error && <span id={errId} className="mt-1 block font-meta text-[12px] font-semibold text-redtext">{error}</span>}
      {hint && !error && <span id={hintId} className="mt-1 block font-meta text-[12px] text-mut">{hint}</span>}
    </div>
  )
}

// The label reads as the field's name, so it is a shade darker than a hint
// and lighter than the value inside the control.
const LABEL = 'mb-[5px] flex items-baseline justify-between font-meta text-[12px] font-semibold text-lab'
const Optional = () => <span className="font-normal text-faint">optional</span>

/**
 * The compact control used in a card header to filter the table below it.
 *
 * It was declared separately in seven modules, and the Stock redesign changed
 * its copy without the other six - so half the app filtered through a 13px
 * rounded-lg box with no focus ring and half through a 12px meta one that
 * highlighted on focus. Same control, two looks, depending which screen you
 * were on. This is the one both were meant to be.
 *
 * Deliberately not `Input`/`Select`: those are full-width form controls, and
 * these sit four-across in a header.
 */
/**
 * The segmented control every module uses to switch views.
 *
 * Five modules drew this by hand as dark pills on a grey tub, and the Dashboard
 * redesign gave it a lighter treatment - a white raised segment on a fill - and
 * changed only itself. Same control, two looks, depending which screen you were
 * on. This is the Dashboard's, shared.
 *
 * `aria-current="page"` on the active segment, so it is announced as the
 * current view rather than just as a pressed button.
 */
/** Fixed so the flip can be decided before the tip is painted. */
const TIP_WIDTH = 248

/**
 * A caveat attached to the figure it qualifies.
 *
 * These explanations used to run as full-width lines under the numbers -
 * "146 collections have no date recorded", "every client scores the same" -
 * where they took more room than the figures and had to be read past on every
 * visit. They are not warnings and they are rarely news after the first time,
 * but they are also not droppable: a percentage built on four of a hundred and
 * fifty is a different fact from one built on all of them, and a screen that
 * does not say so is lying by omission.
 *
 * So the marker sits on the number and the sentence appears on hover or focus.
 * The explanation is always in the DOM rather than conjured on hover, so a
 * screen reader gets it from `aria-describedby` without needing to trigger
 * anything.
 */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const id = useId()
  const marker = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: -9999, left: -9999 })

  /**
   * Positioned in the viewport and rendered into <body>, not beside the marker.
   *
   * It used to be an absolutely positioned sibling, which meant any ancestor
   * that scrolls clipped it: the summary rail of a dialog cut the credit-score
   * explanation in half, and the horizontal scroller now wrapping every table
   * would have done the same to the tips in table headers. A tooltip has no
   * business being inside the box it explains.
   */
  function show() {
    const rect = marker.current?.getBoundingClientRect()
    if (rect) {
      // Right edge of the usable page, not of the window: the to-do rail is
      // fixed over the right-hand side, and a tip that slid under it was
      // technically on screen and unreadable.
      const rail = Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--todo-rail-w'),
      ) || 0
      const rightEdge = window.innerWidth - rail - 8
      setPos({
        top: rect.bottom + 6,
        left: Math.max(8, Math.min(rect.left, rightEdge - TIP_WIDTH)),
      })
    }
    setOpen(true)
  }

  // Scrolling moves the marker and leaves the tip behind, so scrolling dismisses
  // it. Captured, because what scrolls is usually an inner box - a dialog body,
  // a rail - and not the window.
  useEffect(() => {
    if (!open) return
    const hide = () => setOpen(false)
    window.addEventListener('scroll', hide, true)
    return () => window.removeEventListener('scroll', hide, true)
  }, [open])

  return (
    <span className="inline-flex align-middle">
      <button
        ref={marker}
        type="button"
        aria-label={label}
        aria-describedby={id}
        onMouseEnter={show}
        onMouseLeave={() => setOpen(false)}
        onFocus={show}
        onBlur={() => setOpen(false)}
        className="flex h-[14px] w-[14px] cursor-help items-center justify-center rounded-full border border-inputline bg-transparent font-meta text-[9px] font-semibold normal-case leading-none tracking-normal text-mut transition-colors hover:border-mut hover:text-ink focus-visible:border-mut focus-visible:text-ink"
      >
        i
      </button>
      {createPortal(
        <span
          id={id}
          role="tooltip"
          style={{ width: TIP_WIDTH, top: pos.top, left: pos.left }}
          // normal-case and tracking-normal are not decoration: this used to sit
          // inside an uppercase, letter-spaced KPI label and inherited both, so
          // the sentence rendered as shouted small caps. It inherits nothing
          // from <body>, but the guard costs nothing and the day someone renders
          // one inline again it still holds.
          className={`pointer-events-none fixed z-[1300] rounded-[6px] border border-line bg-white p-[10px] text-left font-meta text-[12px] font-normal normal-case leading-[1.5] tracking-normal text-lab shadow-[0_6px_20px_rgba(20,24,27,.14)] transition-opacity ${
            open ? 'opacity-100' : 'opacity-0'
          }`}
        >
          {children}
        </span>,
        document.body,
      )}
    </span>
  )
}

/**
 * A value-against-max bar.
 *
 * Balances and attainment were printed as two numbers for the reader to subtract
 * - "3/5", "68%" - which says how much but not whether that is a lot. The bar
 * carries the proportion; the numbers beside it stay, since a bar cannot be read
 * off precisely.
 *
 * The tone is the caller's to choose, because passing the max means opposite
 * things in different places: a leave balance taken past its entitlement is a
 * problem, a sales quota passed is the point of having one. A component that
 * decided this for itself would be wrong half the time.
 *
 * Past the max the bar fills rather than overflowing its track - the tone says
 * which case it is.
 */
export function Meter({ value, max, tone = 'accent', className = '' }: {
  value: number
  max: number
  tone?: 'accent' | 'alert' | 'good'
  className?: string
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  const fill = tone === 'alert' ? 'bg-redf' : tone === 'good' ? 'bg-greentext' : 'bg-teal'
  return (
    <span className={`block h-[5px] w-full overflow-hidden rounded-full bg-fill2 ${className}`}>
      <span
        className={`block h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none ${fill}`}
        style={{ width: `${pct}%` }}
      />
    </span>
  )
}

export function TabBar<T extends string>({ tabs, active, onChange, labels, counts }: {
  tabs: readonly T[]
  active: T
  onChange: (tab: T) => void
  /** Display text, where the tab key is not what should be shown. */
  labels?: Partial<Record<T, string>>
  /** A number after the label - how many are on that tab. */
  counts?: Partial<Record<T, number>>
}) {
  // The raised segment is one element that slides to the chosen tab rather
  // than a background each button paints for itself, so switching moves it
  // across - the way the page itself fades in - instead of blinking.
  const track = useRef<HTMLSpanElement>(null)
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null)
  useLayoutEffect(() => {
    const el = Array.from(track.current?.querySelectorAll<HTMLButtonElement>('[data-tab]') ?? []).find((b) => b.dataset.tab === active)
    if (!el) return
    setThumb({ left: el.offsetLeft, width: el.offsetWidth })
  }, [active, tabs, labels, counts])
  return (
    <span ref={track} className="relative flex w-fit gap-[2px] rounded-[6px] bg-fill2 p-[2px]">
      {thumb && (
        <span
          aria-hidden
          className="absolute top-[2px] bottom-[2px] rounded-[4px] bg-white shadow-[0_1px_2px_rgba(20,24,27,.05)] transition-[left,width] duration-200 ease-out motion-reduce:transition-none"
          style={{ left: thumb.left, width: thumb.width }}
        />
      )}
      {tabs.map((t) => (
        <button
          key={t}
          type="button"
          data-tab={t}
          onClick={() => onChange(t)}
          aria-current={t === active ? 'page' : undefined}
          className={`relative cursor-pointer whitespace-nowrap rounded-[4px] border-0 bg-transparent px-[11px] py-[4px] font-meta text-[12px] capitalize transition-colors ${
            t === active ? 'font-semibold text-ink' : 'text-mut hover:text-ink'
          }`}
        >
          {labels?.[t] ?? t}
          {counts?.[t] !== undefined && (
            <span className={`tnum ml-[5px] text-[11px] font-semibold ${t === active ? 'text-mut' : 'text-faint'}`}>{counts[t]}</span>
          )}
        </button>
      ))}
    </span>
  )
}

/**
 * Two heights, and everything that sits in a row together uses one of them.
 *
 * Every control used to set its own vertical padding, so a filter row put a
 * 27px search box beside a 27px dropdown beside a 21px Export button with a
 * different corner radius - three heights and two radii in one strip. The
 * heights are stated outright rather than derived from padding and line-height,
 * because a 12px button and a 13px input padded identically still come out a
 * pixel or two apart, and a pixel of mismatch is exactly what reads as sloppy.
 *
 * SM is the toolbar scale: filters, Export, the small row actions.
 * MD is the form scale: inputs, selects, and the buttons in a dialog footer.
 */
const SM = 'inline-flex h-[28px] items-center justify-center rounded-[6px] px-[10px] font-meta text-[12px] font-semibold'
const MD = 'inline-flex h-[36px] items-center justify-center rounded-[8px] px-[13px] font-meta text-[12px] font-semibold'

/** `ctl` is not decoration - see `select.ctl` in index.css, which is what
 *  replaces the browser's own dropdown arrow. */
export const filterCls =
  `ctl h-[28px] rounded-[6px] border border-inputline bg-white px-[10px] font-meta text-[12px] font-[inherit] text-ink focus:border-teal focus:outline-none`

/**
 * `w-full` here is why a caller wanting a fixed width has to write `!w-[104px]`
 * rather than `w-[104px]`: the two utilities tie on specificity and the loser is
 * decided by their order in the sheet, not by the order in the className. Same
 * for the 36px height. It is a footgun, and the alternative - dropping w-full
 * and having Field stretch its control - would silently shrink the several
 * dozen controls that live outside a Field and rely on it.
 */
const controlCls = 'ctl box-border h-[36px] w-full rounded-[8px] border border-inputline bg-white px-[12px] font-[inherit] text-[13px] focus:border-teal focus:outline-none'

/**
 * Both merge `className` rather than replacing it.
 *
 * They used to set `className={controlCls}` outright, so a caller passing one
 * had it silently dropped - spread order meant the prop was overwritten a line
 * after being spread in. Nothing was passing one yet, which is the only reason
 * it had not bitten; the first caller to try would have found the class simply
 * not applied, with nothing to explain why.
 */
export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${controlCls} ${className ?? ''}`} />
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${controlCls} ${className ?? ''}`} />
}

/**
 * A control for text that runs to a sentence or two.
 *
 * Notes fields were single-line Inputs, which let you type a paragraph and then
 * showed you eight words of it. Same border, radius and focus ring as Input;
 * the only differences are height and that it wraps.
 */
export function Textarea({ className, rows = 3, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      rows={rows}
      className={`ctl box-border w-full resize-y rounded-[8px] border border-inputline bg-white px-[12px] py-[8px] font-[inherit] text-[13px] leading-[1.5] focus:border-teal focus:outline-none ${className ?? ''}`}
    />
  )
}

/**
 * The affirmative action on a screen: ink ground, white text.
 *
 * `size="sm"` is for actions that sit inside a row or a card header rather than
 * at the foot of a form. It replaces TintButton, which was the same button in
 * accent tint - teal text on a teal wash - and which nine of its twelve callers
 * were already overriding with !important padding to reach roughly this
 * button's default size. Two components meaning "the action here" is one too
 * many; the difference between them was never more than scale.
 */
export function PrimaryButton({ children, onClick, className, size = 'md', disabled, tone = 'ink' }: {
  children: ReactNode
  onClick?: () => void
  className?: string
  size?: 'sm' | 'md'
  disabled?: boolean
  /** `danger` for the button that deletes or replaces something: the one
   * action in a confirmation that should not look like every other Save. */
  tone?: 'ink' | 'danger'
}) {
  const fill = tone === 'danger'
    ? 'bg-redf text-white hover:bg-redtext disabled:hover:bg-redf'
    : 'bg-ink text-white hover:bg-inkhov disabled:hover:bg-ink'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${size === 'sm' ? SM : MD} cursor-pointer transition-[background-color,border-color,color,transform] duration-150 active:scale-[.985] motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 ${fill} ${className ?? ''}`}
    >
      {children}
    </button>
  )
}

export function GhostButton({ children, onClick, disabled, title, size = 'md', className = '' }: {
  children: ReactNode
  onClick?: () => void
  className?: string
  /** `sm` for a card header or toolbar, `md` at the foot of a form - the two
   *  control heights the app has. */
  size?: 'sm' | 'md'
  /** For actions that talk to the server. Without it a second click while the
   *  first is in flight sends the request twice - which for anything that
   *  allocates a reference number means two numbers. */
  disabled?: boolean
  title?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`${size === 'sm' ? SM : MD} cursor-pointer border border-inputline bg-white text-lab transition-[background-color,border-color,color,transform] duration-150 active:scale-[.985] motion-reduce:transition-none hover:bg-fill2 disabled:cursor-default disabled:opacity-50 disabled:active:scale-100 ${className}`}
    >
      {children}
    </button>
  )
}

/** Small neutral action button (MARK RECEIVED, CONFIRM, ASSIGN). */
/**
 * One option in a small set, as a card rather than a line in a dropdown.
 *
 * A dropdown shows one option at a time and hides what each one means, which
 * is wrong wherever the choice has consequences - what happens to the money
 * on a return, what a collection outcome does to an account's credit. These
 * put the options side by side with their meaning underneath.
 */
export function Choices({ children, cols = 2 }: { children: ReactNode; cols?: 2 | 3 | 4 }) {
  const grid = cols === 4 ? 'grid-cols-4' : cols === 3 ? 'grid-cols-3' : 'grid-cols-2'
  return <div className={`grid ${grid} gap-[8px]`}>{children}</div>
}

export function ChoiceCard({ on, onClick, title, note, tone = 'accent', children }: {
  on: boolean
  onClick: () => void
  title: string
  note?: string
  /** `bad` marks an outcome that counts against someone - a bounce, a loss. */
  tone?: 'accent' | 'bad'
  children?: ReactNode
}) {
  const ring = tone === 'bad' ? 'border-redf bg-redbadge/50' : 'border-teal bg-tealbadge/40'
  const tick = tone === 'bad' ? 'border-redf bg-redf' : 'border-teal bg-teal'
  return (
    <div
      role="radio"
      aria-checked={on}
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }}
      className={`relative flex cursor-pointer flex-col rounded-[10px] border px-[12px] py-[10px] text-left transition-[background-color,border-color,transform] duration-150 active:scale-[.99] motion-reduce:transition-none ${
        on ? ring : 'border-line bg-white hover:border-inputline hover:bg-fill2'
      }`}
    >
      <span className="flex items-start justify-between gap-[8px]">
        <span className="text-[13px] font-semibold leading-[1.3]">{title}</span>
        <span className={`mt-[1px] flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-full border ${on ? `${tick} text-white` : 'border-inputline bg-white'}`}>
          {on && <Check size={10} strokeWidth={3} />}
        </span>
      </span>
      {note && <span className="mt-[3px] font-meta text-[12px] leading-[1.4] text-mut">{note}</span>}
      {children}
    </div>
  )
}

/** A numbered question, so a short form reads as a sequence. */
export function Step({ n, title, children, last }: { n: number; title: string; children: ReactNode; last?: boolean }) {
  return (
    <div className={`grid grid-cols-[26px_1fr] gap-x-[12px] ${last ? '' : 'mb-[20px]'}`}>
      <span className="tnum flex h-[22px] w-[22px] items-center justify-center rounded-full bg-ink font-meta text-[11px] font-semibold text-white">{n}</span>
      <div className="min-w-0">
        <p className="m-0 mb-[8px] pt-[2px] text-[13px] font-semibold leading-[1.3]">{title}</p>
        {children}
      </div>
    </div>
  )
}

export function MiniDark({ children, onClick, title }: { children: ReactNode; onClick?: () => void; title?: string }) {
  return (
    <button type="button" onClick={onClick} title={title} className={`${SM} shrink-0 cursor-pointer whitespace-nowrap border border-inputline bg-white text-lab transition-[background-color,border-color,color,transform] duration-150 active:scale-[.985] motion-reduce:transition-none hover:bg-fill2`}>
      {children}
    </button>
  )
}

/**
 * Downloads what is on screen as a spreadsheet.
 *
 * Its own component so the control cannot drift again: one screen still had a
 * hand-rolled accent-tinted copy after the rest had moved on, and the six of
 * them sat in six different places in their header rows. This one is always the
 * last thing in its row, so it is in the same corner on every screen.
 */
export function ExportButton({ onClick, label = 'Export' }: { onClick: () => void; label?: string }) {
  return <MiniDark onClick={onClick} title="Download what is on screen as a spreadsheet">{label}</MiniDark>
}

const thCls = 'border-b border-line px-3 py-[8px] font-meta text-[10px] font-semibold uppercase tracking-[.09em] text-faint'

export interface Col {
  /** ReactNode so a column whose basis is not obvious can carry an InfoTip. */
  label: ReactNode
  align?: 'left' | 'right'
  /** Enables click-to-sort on this header; must match the key passed to onSort. */
  sortKey?: string
}

const pagerBtn = `${SM} cursor-pointer border border-inputline bg-white text-lab hover:bg-fill2 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white`

/**
 * The footer for a paged list. Renders nothing when everything fits on one page.
 *
 * `compact` is for narrow containers - a side panel, not a full-width table.
 * The default footer needs about 400px before "Showing 1-8 of 20 employees"
 * wraps onto a second line and the word-labelled buttons start crowding the page
 * count. The compact one drops the sentence to its numbers and the buttons to
 * their arrows, which fits a 340px column on one line.
 */
/**
 * The one row action for every list in the app: a 26px icon button with the
 * verb as its tooltip and accessible name. Lists used to mix uppercase text
 * links ("EDIT", "REVERT") with icon buttons from screen to screen; this is
 * the icon button, and the verbs map to fixed icons so a pencil always means
 * edit and a bin always means delete.
 */
// Revert is a circling-back arrow and Return is a crossed-out package: the
// two used to be a pair of near-identical bent arrows, which told nobody
// which one put the status back and which one sent the fuel back.
export const ROW_ICONS = { edit: Pencil, delete: Trash2, revert: RotateCcw, cancel: CircleX, return: PackageX } as const
export type RowVerb = keyof typeof ROW_ICONS

export function RowAction({ verb, label, onClick, icon, tone, disabled, className = '' }: {
  verb: RowVerb
  /** The accessible name and tooltip, e.g. "Edit Seaoil" or "Revert to ordered". */
  label: string
  onClick: () => void
  /** Override the verb's icon for a one-off. */
  icon?: LucideIcon
  /** Red on hover for anything that removes or reverses; the default follows the verb. */
  tone?: 'plain' | 'danger'
  disabled?: boolean
  className?: string
}) {
  const Icon = icon ?? ROW_ICONS[verb]
  const danger = tone ? tone === 'danger' : verb !== 'edit'
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick() }}
      aria-label={label}
      data-tip={label}
      disabled={disabled}
      className={`inline-flex h-[26px] w-[26px] shrink-0 cursor-pointer items-center justify-center rounded-[6px] border-0 bg-transparent text-mut transition-[background-color,color,transform] duration-150 hover:bg-fill2 active:scale-[.92] disabled:cursor-default disabled:opacity-40 motion-reduce:transition-none ${
        danger ? 'hover:text-redtext' : 'hover:text-ink'
      } ${className}`}
    >
      <Icon size={14} strokeWidth={1.8} />
    </button>
  )
}

export function Pager({ page, totalPages, setPage, total, pageSize, noun = '', compact = false }: {
  page: number
  totalPages: number
  setPage: (fn: (p: number) => number) => void
  total: number
  pageSize?: number
  /** Shown after the range, e.g. "of 34 employees". Dropped when compact. */
  noun?: string
  compact?: boolean
}) {
  if (!pageSize || total === 0 || totalPages <= 1) return null
  const from = (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)
  const back = () => setPage((p) => Math.max(1, p - 1))
  const forward = () => setPage((p) => Math.min(totalPages, p + 1))
  const btn = compact ? `${pagerBtn} h-[22px] w-[22px] !px-0 leading-none` : pagerBtn

  return (
    <div className={`flex items-center justify-between gap-2 border-t border-linesoft px-[14px] font-meta text-[12px] text-mut ${compact ? 'py-[7px]' : 'py-2'}`}>
      <span className="tnum whitespace-nowrap">
        {compact ? `${from}–${to} of ${total}` : `Showing ${from}–${to} of ${total}${noun ? ` ${noun}` : ''}`}
      </span>
      <span className={`flex items-center ${compact ? 'gap-[6px]' : 'gap-3'}`}>
        <button type="button" onClick={back} disabled={page <= 1} className={btn} aria-label="Previous page">
          {compact ? '‹' : '‹ Prev'}
        </button>
        <span className="tnum whitespace-nowrap font-semibold text-lab">
          {compact ? `${page} / ${totalPages}` : `Page ${page} of ${totalPages}`}
        </span>
        <button type="button" onClick={forward} disabled={page >= totalPages} className={btn} aria-label="Next page">
          {compact ? '›' : 'Next ›'}
        </button>
      </span>
    </div>
  )
}

export function DataTable({ cols, children, empty, sort, onSort, pageSize, resetKey }: {
  cols: Col[]
  children: ReactNode
  empty?: string
  /** Current sort state, from useSortableTable(). Omit for a non-sortable table. */
  sort?: SortState | null
  /** Called with a column's sortKey when its header is clicked. */
  onSort?: (key: string) => void
  /** Enables pagination, showing this many rows per page (hidden entirely when rows fit on one page). */
  pageSize?: number
  /** Changing this value (search text, filters, sort, date range…) jumps back to page 1. */
  resetKey?: string | number
}) {
  const rows = Array.isArray(children) ? children.flat().filter(Boolean) : children ? [children] : []
  const { pageItems: pageRows, page, totalPages, setPage, total } = usePaged(rows, pageSize, resetKey)

  return (
    <>
      {/* The table scrolls inside its own box.
          Cells that must not wrap - a date, a peso amount, a row's actions -
          give a table a minimum width, and with the to-do rail open the content
          column is narrow enough to hit it. The overflow went to the page, so
          the whole layout slid sideways under the fixed sidebar and rail. It
          belongs to the table. The fade is for a table swapped in whole by a
          tab switch (a `key` on the table): it comes in the way a page does. */}
      <div className="fade-in overflow-x-auto">
        <table className="tnum w-full border-collapse text-[13px]">
        <thead>
          <tr>
            {cols.map((c, i) => {
              const sortable = !!c.sortKey && !!onSort
              const active = sortable && sort?.key === c.sortKey
              return (
                <th
                  key={i}
                  onClick={sortable ? () => onSort!(c.sortKey!) : undefined}
                  className={`${thCls} ${c.align === 'right' ? 'text-right' : 'text-left'} ${i === 0 ? 'pl-[14px]' : ''} ${i === cols.length - 1 ? 'pr-[14px]' : ''} ${sortable ? 'cursor-pointer select-none hover:text-mut' : ''}`}
                >
                  <span className={`inline-flex items-center gap-[3px] ${c.align === 'right' ? 'flex-row-reverse' : ''}`}>
                    {c.label}
                    {sortable && (
                      <span className={`text-[9px] ${active ? '' : 'opacity-30'}`}>
                        {active && sort!.dir === 'asc' ? '▲' : '▼'}
                      </span>
                    )}
                  </span>
                </th>
              )
            })}
          </tr>
        </thead>
          <tbody>{pageRows}</tbody>
        </table>
      </div>
      {rows.length === 0 && (
        <p className="px-[14px] py-7 text-center text-[13px] text-faint">{empty ?? 'Nothing here for this filter.'}</p>
      )}
      <Pager page={page} totalPages={totalPages} setPage={setPage} total={total} pageSize={pageSize} />
    </>
  )
}

export const td = 'px-3 py-[9px] border-b border-linesoft'

/** Neutral initials bubble. `tint` is still accepted so no caller changed, but
 * all three tints now resolve to the same neutral - the colour never encoded
 * anything, it just added three more hues to the screen. */
export function Avatar({ name, tint, size = 22 }: { name: string; tint?: 'amber' | 'teal' | 'neutral'; size?: number }) {
  void tint
  const initials = name.replace(/^SG /, '').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()
  return (
    <span
      className="flex items-center justify-center rounded-full bg-fill2 font-meta font-semibold text-sec"
      style={{ width: size, height: size, fontSize: size < 26 ? 10 : 12 }}
    >
      {initials}
    </span>
  )
}

/** Per-screen header row: title + subtitle + right-hand control. */
export function PageHeader({ title, subtitle, right }: { title: ReactNode; subtitle?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-[14px] flex flex-wrap items-end gap-[14px]">
      <div className="min-w-0">
        <h1 className="m-0 text-[20px] font-semibold leading-[1.2] tracking-[-0.02em]">{title}</h1>
        {subtitle && <p className="m-0 mt-[2px] font-meta text-[12px] text-mut">{subtitle}</p>}
      </div>
      {/* The page's own controls. A page with a create action passes it here,
          rightmost - see CreateAction in lib/quickCreate. It is passed rather
          than looked up inside this component: PageHeader would otherwise need
          the router, and every test rendering any screen would need to provide
          one to draw a heading. */}
      <span className="ml-auto flex items-center gap-2">{right}</span>
    </div>
  )
}

// ---- Loading ----------------------------------------------------------------

/** One grey block, sized by the caller. */
export function Bone({ w = '100%', h = 12, className = '' }: { w?: number | string; h?: number; className?: string }) {
  return <span aria-hidden className={`skeleton block ${className}`} style={{ width: w, height: h }} />
}

/**
 * The shape of an office page before its tables arrive: a title, a strip of
 * figures, a table. Every module used to render nothing here, so a slow
 * connection looked like a broken app. `rows` and `kpis` let a page that has
 * no strip, or a longer table, keep roughly its own outline.
 */
export function PageSkeleton({ kpis = 4, rows = 6, title = true }: { kpis?: number; rows?: number; title?: boolean }) {
  return (
    <div className="fade-in" role="status" aria-label="Loading" aria-live="polite">
      {title && (
        <div className="mb-[14px] flex items-end gap-[14px]">
          <div>
            <Bone w={160} h={20} />
            <Bone w={260} h={11} className="mt-[8px]" />
          </div>
          <Bone w={120} h={28} className="ml-auto" />
        </div>
      )}
      {kpis > 0 && (
        <div className="mb-[18px] grid gap-px overflow-hidden rounded-[8px] border border-line bg-linesoft" style={{ gridTemplateColumns: `repeat(${kpis}, minmax(0, 1fr))` }}>
          {Array.from({ length: kpis }, (_, i) => (
            <div key={i} className="bg-white p-[14px]">
              <Bone w={70} h={9} />
              <Bone w={110} h={20} className="mt-[10px]" />
              <Bone w={90} h={10} className="mt-[8px]" />
            </div>
          ))}
        </div>
      )}
      <div className="overflow-hidden rounded-[8px] border border-line bg-white">
        <div className="flex items-center gap-[10px] border-b border-linesoft px-[14px] py-[12px]">
          <Bone w={130} h={13} />
          <Bone w={200} h={28} className="ml-auto" />
        </div>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-[16px] border-b border-linesoft px-[20px] py-[13px] last:border-b-0">
            <Bone w={90} h={11} />
            <Bone w={220} h={11} />
            <Bone w={80} h={11} className="ml-auto" />
            <Bone w={60} h={11} />
          </div>
        ))}
      </div>
    </div>
  )
}

/** The phone screens' shape: a headline figure and a list of rows. */
export function PhoneSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="fade-in px-[16px] pt-[18px]" role="status" aria-label="Loading" aria-live="polite">
      <Bone w={120} h={10} />
      <Bone w={180} h={24} className="mt-[8px]" />
      <div className="mt-[18px] grid grid-cols-2 gap-[10px]">
        <Bone h={56} /><Bone h={56} />
      </div>
      <div className="mt-[18px] flex gap-[8px]">
        <Bone w={90} h={30} /><Bone w={80} h={30} /><Bone w={80} h={30} />
      </div>
      <div className="mt-[14px] flex flex-col gap-[8px]">
        {Array.from({ length: rows }, (_, i) => <Bone key={i} h={64} />)}
      </div>
    </div>
  )
}
