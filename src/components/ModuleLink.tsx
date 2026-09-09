import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { moduleForPath } from '../lib/nav'

/**
 * A jump into another module, drawn as that module's own icon.
 *
 * These links were words, and the words were carrying less than they looked
 * like they were: three rows of Needs attention all read "Open" and went to
 * three different places, while the card headers repeated the destination's
 * name beside a title that already implied it. The icon is the same mark the
 * nav rail uses for that module, so the rail teaches it once.
 *
 * The words are not thrown away - they move to the hover title and to the
 * accessible name, because an icon alone is not a label.
 *
 * It is drawn as a bordered control rather than as a bare glyph, which is the
 * part that makes it read as clickable. Looking at how other products do this -
 * Clerk, Maze, Mixpanel, Copy.ai - none of them ship a naked icon for
 * navigation: it is either a text link with a trailing arrow, or an icon inside
 * a visible boundary, or a "..." that opens a menu rather than navigating. The
 * boundary is what signals the affordance, not the glyph, so this borrows the
 * same chrome the app's other small buttons already use and adds a chevron for
 * the direction - the module icon says where, the chevron says that it goes.
 */
export function ModuleLink({ to, action = 'Open', destination, className = '' }: {
  to: string
  /** The verb, when it is not simply opening the page - "Review", say. */
  action?: string
  /**
   * What to call the destination, when the module's own name is not what the
   * link goes to. Input history lives under Settings and so resolves to the
   * Settings icon, but "Open Settings" is not where that link goes and is not
   * what a screen reader should hear. The icon still comes from the module -
   * one mark per place, as the rail teaches it - and only the name is
   * overridden.
   */
  destination?: string
  className?: string
}) {
  const { icon: Icon, label } = moduleForPath(to)
  const name = `${action} ${destination ?? label}`
  return (
    <Link
      to={to}
      title={name}
      aria-label={name}
      className={`flex shrink-0 items-center gap-[1px] rounded-[6px] border border-inputline bg-white py-[3px] pl-[6px] pr-[3px] text-mut transition-colors hover:border-linesoft hover:bg-fill2 hover:text-ink ${className}`}
    >
      <Icon size={14} strokeWidth={1.8} />
      <ChevronRight size={13} strokeWidth={2} className="text-faint" />
    </Link>
  )
}
