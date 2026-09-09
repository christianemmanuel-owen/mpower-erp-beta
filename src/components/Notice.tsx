import type { ReactNode } from 'react'

/**
 * A standing count, said in one line.
 *
 * These were drawn three different ways: a filled Chip in the purchases
 * toolbar, and a two-line amber card above seven other screens - the card in
 * raw Tailwind ambers rather than the app's own tokens, so it was a shade
 * nobody else used. Both took a band of the page to report a number.
 *
 * A count is not an alarm. The dot carries the state, the sentence carries the
 * number, and red appears only when there is something to do about it - the
 * same rule the dashboard follows. Where the count can be acted on, the action
 * is part of the line rather than something to go and find.
 */
export function InlineNotice({ tone = 'plain', action, onAction, children, className = '' }: {
  tone?: 'plain' | 'act'
  /** The verb, when the count leads somewhere. Omitted, the line is a statement. */
  action?: string
  onAction?: () => void
  children: ReactNode
  className?: string
}) {
  return (
    <span className={`inline-flex items-center gap-[7px] font-meta text-[12px] leading-[1.4] ${className}`}>
      <span
        aria-hidden
        className={`h-[6px] w-[6px] shrink-0 rounded-full ${tone === 'act' ? 'bg-redf' : 'bg-inputline'}`}
      />
      <span className={tone === 'act' ? 'text-redtext' : 'text-mut'}>{children}</span>
      {action && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="cursor-pointer border-0 bg-transparent p-0 font-meta text-[12px] font-semibold text-sec underline-offset-2 transition-colors hover:text-ink hover:underline"
        >
          {action}
        </button>
      )}
    </span>
  )
}
