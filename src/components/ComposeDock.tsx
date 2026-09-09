import { createPortal } from 'react-dom'
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { ChevronDown, Pencil, X } from 'lucide-react'

/**
 * A compose panel docked to the bottom corner, the way mail clients do it.
 *
 * The difference from `Dialog` is not decoration. A dialog is modal: it dims
 * the page, traps focus, locks scrolling, and closes on Escape - all correct
 * when the form must be finished or abandoned before anything else happens. A
 * post to the announcement board is not that. It is written while looking at
 * the board it is going onto, and half the reason to write one is something
 * else on screen. So this one dims nothing, traps nothing and leaves the page
 * live underneath.
 *
 * Escape minimises rather than closes. In a modal, Escape discards a form
 * nobody has invested in yet; here it would throw away something typed, and a
 * compose window that loses a draft to a stray keystroke is worse than one
 * that is slightly harder to dismiss.
 *
 * It sits clear of the to-do rail by reading the width the rail already
 * publishes for the shell, so it moves when the rail collapses instead of
 * sliding underneath it.
 *
 * Collapsed, the dock is its own trigger. There is no separate button
 * elsewhere: the way in and the thing it opens are the same object, in the same
 * corner, and it is the only one of the two that can say a half-written post is
 * waiting - which it does, with a Draft mark.
 *
 * It also starts narrow and widens once there is something written in it. An
 * empty panel is a button with fields attached and should take as little room
 * as it can; one being used should take what it needs.
 */
export default function ComposeDock({
  show, expanded, idleLabel, title, onExpand, onMinimise, onDiscard, children, footer,
  width = 400, hasDraft = false,
}: {
  /** Whether the dock belongs on screen at all - false for a seat that may not post. */
  show: boolean
  expanded: boolean
  /** What the collapsed bar reads when nothing is being written. */
  idleLabel: string
  title: string
  onExpand: () => void
  /** Collapse, keeping whatever is typed. */
  onMinimise: () => void
  /** Collapse and throw the draft away. */
  onDiscard: () => void
  children: ReactNode
  footer?: ReactNode
  /**
   * Current width. The caller widens it once there is something to write into,
   * so an empty panel stays out of the way and one being used takes the room
   * it needs. Changes are animated - see the transition below.
   */
  width?: number
  /** Something typed but not posted, so the collapsed bar can say so. */
  hasDraft?: boolean
}) {
  const panel = useRef<HTMLDivElement>(null)
  const titleId = useId()

  useEffect(() => {
    if (!expanded) return
    const first = panel.current?.querySelector<HTMLElement>('input, textarea, select')
    first?.focus()
  }, [expanded])

  useEffect(() => {
    if (!expanded) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && panel.current?.contains(document.activeElement)) {
        e.stopPropagation()
        onMinimise()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [expanded, onMinimise])

  if (!show) return null

  // Collapsed, the dock IS the button. A separate New post control in the top
  // bar meant the way in and the thing it opened were in opposite corners of
  // the screen, and the panel was the only one of the two that could tell you
  // there was a half-written post waiting.
  if (!expanded) {
    return createPortal(
      <button
        type="button"
        onClick={onExpand}
        className="fixed bottom-0 z-[1100] flex cursor-pointer items-center gap-2 rounded-t-[10px] border border-b-0 border-line bg-white px-[14px] py-[9px] text-[13px] font-semibold text-ink shadow-[0_-6px_20px_rgba(20,24,27,.10)] transition-colors hover:bg-paper"
        style={{ right: 'calc(var(--todo-rail-w, 0px) + 22px)' }}
      >
        <Pencil size={14} strokeWidth={1.9} className="text-mut" />
        {idleLabel}
        {/* The reason for folding the trigger into the panel was that only the
            panel could know a half-written post was waiting. This is that
            knowledge, said out loud. */}
        {hasDraft && (
          <span className="rounded-[4px] bg-amberbadge px-[6px] py-[1px] font-meta text-[10px] font-semibold uppercase tracking-[.09em] text-ambertext">
            Draft
          </span>
        )}
      </button>,
      document.body,
    )
  }

  return createPortal(
    <div
      ref={panel}
      role="dialog"
      aria-labelledby={titleId}
      // The width is animated rather than snapped: the panel grows as soon as
      // there is something in it, and a jump would read as the layout breaking
      // rather than as the panel making room.
      className="fixed bottom-0 z-[1100] flex flex-col overflow-hidden rounded-t-[10px] border border-b-0 border-line bg-white shadow-[0_-8px_32px_rgba(20,24,27,.16)] transition-[width] duration-200 ease-out motion-reduce:transition-none"
      style={{
        width,
        maxWidth: 'calc(100vw - 32px)',
        right: 'calc(var(--todo-rail-w, 0px) + 22px)',
        animation: 'dockIn .18s ease both',
      }}
    >
      <div className="flex items-center gap-2 border-b border-linesoft bg-paper px-[14px] py-[9px]">
        <span id={titleId} className="min-w-0 flex-1 truncate text-[13px] font-semibold">{title}</span>
        <button
          type="button"
          onClick={onMinimise}
          aria-label="Minimise"
          className="flex h-[24px] w-[24px] shrink-0 cursor-pointer items-center justify-center rounded-[6px] border-0 bg-transparent text-mut transition-colors hover:bg-fill2 hover:text-ink"
        >
          <ChevronDown size={15} strokeWidth={2} />
        </button>
        <button
          type="button"
          onClick={onDiscard}
          aria-label="Discard"
          className="flex h-[24px] w-[24px] shrink-0 cursor-pointer items-center justify-center rounded-[6px] border-0 bg-transparent text-mut transition-colors hover:bg-fill2 hover:text-ink"
        >
          <X size={15} strokeWidth={2} />
        </button>
      </div>

      <div className="max-h-[50vh] overflow-y-auto px-[14px] py-[14px]">{children}</div>
      {footer && (
        <div className="flex items-center gap-2 border-t border-linesoft px-[14px] py-[10px]">{footer}</div>
      )}
    </div>,
    document.body,
  )
}
