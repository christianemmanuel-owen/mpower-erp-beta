import { ArrowUpRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { moduleForPath } from '../lib/nav'
import { peekTarget, usePeek } from '../lib/peek'

/**
 * A jump to another page, drawn as one mark everywhere: an arrow to the top
 * right inside a small bordered square, which nudges towards where it points
 * on hover. The destination lives in the tooltip and the accessible name
 * ("Open Collect", "Review Approvals"), because an arrow alone is not a label.
 *
 * It used to be the destination module's own icon with a chevron, which meant
 * six different glyphs for the one idea "this takes you somewhere". No border:
 * it is the same borderless 26px square as every row action (RowAction), so
 * the arrow sits beside a pencil or a bin as one family, and in a list row it
 * only appears on hover anyway.
 */
export function ModuleLink({ to, action = 'Open', destination, reveal = false, className = '' }: {
  to: string
  /** The verb, when it is not simply opening the page - "Review", say. */
  action?: string
  /** What to call the destination, when the module's own name is not what the
   * link goes to - Input history lives under Settings. */
  destination?: string
  /** In a list row: hidden until the row (a `group`) is hovered or the link
   * itself is focused, so a column of rows is not a column of arrows. A card
   * header's link is always shown - there is no row to hover. */
  reveal?: boolean
  className?: string
}) {
  const { label } = moduleForPath(to)
  const name = `${action} ${destination ?? label}`
  // A link to one record opens it over this page rather than in its
  // module (lib/peek.tsx). A modified click - new tab, say - still gets the
  // real route, and so does any link to a list rather than a record.
  const peek = usePeek()
  const target = peekTarget(to)
  return (
    <Link
      to={to}
      onClick={(e) => {
        if (!peek || !target || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
        e.preventDefault()
        peek.open(target)
      }}
      data-tip={name}
      aria-label={name}
      className={`go-link flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[6px] border-0 bg-transparent text-mut transition-[background-color,color,opacity] duration-150 hover:bg-fill2 hover:text-ink ${
        reveal ? 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100' : ''
      } ${className}`}
    >
      <ArrowUpRight size={14} strokeWidth={2} className="go-arrow" />
    </Link>
  )
}

/** The same arrow, for a control that navigates but is not a Link - a row
 * that calls navigate(), say. The nudge follows the row's own hover. */
export function GoArrow({ size = 13, className = '' }: { size?: number; className?: string }) {
  return <ArrowUpRight size={size} strokeWidth={2.2} className={`go-arrow ${className}`} aria-hidden />
}
