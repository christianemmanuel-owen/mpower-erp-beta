import { createContext, useContext, useState, type MouseEvent, type ReactNode } from 'react'
import { Link, useNavigate, type LinkProps } from 'react-router-dom'

/**
 * Opening a record where you stand.
 *
 * Every "open the record" link used to navigate to the record's module and
 * pop its drawer there, which meant reading a purchase from Input history
 * cost you the history page. A peek opens the same drawer over the page you
 * are on; close it and you are back where you were. The module route still
 * works - it is what a bookmark or a cmd-click gets - this is only the
 * default for a plain click.
 *
 * Only the records with a drawer of their own can be peeked. The rest
 * (customers, suppliers, employees) open as tables in their module, and a
 * link to one of those still navigates.
 */
/** `collection` is one installment's settle dialog; its id is `saleId::installmentId`. */
export type PeekTable = 'sales' | 'purchases' | 'deliveries' | 'collection'

export interface Peek { tbl: PeekTable; id: string }

const BY_PATH: Record<string, PeekTable> = {
  sales: 'sales', 'inventory/purchases': 'purchases', logistics: 'deliveries', collection: 'collection',
}

/** The table a record link points at, when that record can be peeked. */
export function peekTarget(href: string): Peek | null {
  const m = /^\/(sales|inventory\/purchases|logistics|collection)\?record=([^&]+)$/.exec(href)
  if (!m) return null
  return { tbl: BY_PATH[m[1]], id: decodeURIComponent(m[2]) }
}

const Ctx = createContext<{ peek: Peek | null; open: (p: Peek) => void; close: () => void } | null>(null)

export function PeekProvider({ children }: { children: ReactNode }) {
  const [peek, setPeek] = useState<Peek | null>(null)
  return <Ctx.Provider value={{ peek, open: setPeek, close: () => setPeek(null) }}>{children}</Ctx.Provider>
}

/** Null outside a provider (tests, the field shell), so callers fall back to navigating. */
export function usePeek() {
  return useContext(Ctx)
}

/** A plain click, as opposed to one asking for a new tab or window. */
const plainClick = (e: MouseEvent) => !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) && e.button === 0

/**
 * Where to send a record link: the drawer over this page when the record
 * can be peeked and a provider is present, the module otherwise. For code
 * that navigates on its own - a row's onClick, a calendar entry - rather
 * than through a Link.
 */
export function useOpenRecord(): (href: string) => void {
  const peek = usePeek()
  const navigate = useNavigate()
  return (href) => {
    const target = peek ? peekTarget(href) : null
    if (target && peek) peek.open(target)
    else navigate(href)
  }
}

/**
 * A Link that peeks when it can. Drop-in for react-router's Link wherever
 * the destination is a record; a modified click, a list destination, or no
 * provider (the phone shell) all fall through to the real navigation.
 */
export function RecordLink({ to, onClick, children, ...rest }: LinkProps) {
  const peek = usePeek()
  const target = typeof to === 'string' && peek ? peekTarget(to) : null
  return (
    <Link
      to={to}
      onClick={(e) => {
        onClick?.(e)
        if (e.defaultPrevented || !target || !peek || !plainClick(e)) return
        e.preventDefault()
        peek.open(target)
      }}
      {...rest}
    >
      {children}
    </Link>
  )
}
