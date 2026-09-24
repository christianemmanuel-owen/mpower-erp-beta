import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { nav, navIcons, type NavGroup, type NavItem } from './lib/nav'
import { badgeFor, navBadges, type NavBadges } from './lib/navBadges'
import { PeekProvider } from './lib/peek'
import RecordPeek from './components/RecordPeek'
import { useTableIf } from './lib/data'
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { LayoutDashboard, Settings as SettingsIcon, ChevronDown, HandCoins, LogOut, UploadCloud, Truck, Banknote, CheckSquare, History } from 'lucide-react'
import { ToastProvider } from './components/Toast'
import Tooltips from './components/Tooltips'
import { RangeProvider } from './lib/range'
import { QuickCreateProvider } from './lib/quickCreate'
import { AuthProvider, canAccess, fieldPages, hasFieldShell, homePath, useAuth } from './lib/auth'
import MyTrips from './modules/field/MyTrips'
import MySales from './modules/field/MySales'
import MyCollections from './modules/field/MyCollections'
import MyTasks, { openTaskCount } from './modules/field/MyTasks'
import { useKeyboardOpen } from './modules/field/shell'
import { useTable } from './lib/data'
import { useApprovals } from './lib/approvals'
import { api } from './lib/api'
import { queryClient } from './lib/queryClient'
import { countRecords, readLegacyLocalData } from './lib/migrate'
import type { ModuleKey } from './data/types'
import Login from './modules/auth/Login'
import Dashboard from './modules/dashboard/Dashboard'
import CalendarPage, { layersFor } from './modules/dashboard/CalendarPage'
import Inventory from './modules/inventory/Inventory'
import Sales from './modules/sales/Sales'
import Collection from './modules/collection/Collection'
import Treasury from './modules/treasury/Treasury'
import Logistics from './modules/logistics/Logistics'
import Accounts from './modules/accounts/Accounts'
import Hr from './modules/hr/Hr'
import Settings from './modules/settings/Settings'
import Approvals from './modules/settings/Approvals'
import InputHistory from './modules/settings/InputHistory'
import NotificationBell from './components/NotificationBell'
import TodoRail from './components/TodoRail'
import logo from './assets/logo.png'


/**
 * The sidebar groups encode something true about the business rather than
 * just chunking a list: Operations moves fuel, Revenue moves money, People is
 * HR. Home sits above the groups because it isn't one of them.
 */
const groupOrder: NavGroup[] = ['Operations', 'Revenue', 'People']

/* Placeholders for the parked global search above. Kept next to it so bringing
   it back is one uncomment rather than a rewrite.
const searchHints: Record<string, string> = {
  '/': 'Search sales, customers, trucks…',
  '/inventory': 'Search purchases, suppliers…',
  '/sales': 'Search customers, invoices…',
  '/collection': 'Search customers, collectors…',
  '/collection/calendar': 'Search customers…',
  '/collection/balances': 'Search customers…',
  '/collection/collectors': 'Search collectors…',
  '/treasury': 'Search customers…',
  '/treasury/payables': 'Search suppliers…',
  '/accounts': 'Search customers…',
  '/accounts/suppliers': 'Search suppliers…',
  '/logistics': 'Search trips, trucks, drivers…',
  '/logistics/maintenance': 'Search maintenance…',
  '/logistics/bans': 'Search ban rules…',
  '/hr': 'Search employees, payslips…',
  '/settings': 'Search records…',
  '/settings/approvals': 'Search pending inputs…',
  '/settings/history': 'Search entries…',
}
*/

/**
 * Selection is carried by weight and colour, not by a filled box.
 *
 * The white card behind the active row was a second shape competing with the
 * cards on the page beside it, and on a sidebar that is already a lighter
 * surface it read as a raised tile rather than a highlight. Darkening the text
 * and thickening it says the same thing with nothing drawn.
 */
const navItemCls = (isActive: boolean) =>
  `relative flex items-center gap-[9px] rounded-[6px] px-2 py-[6px] text-[13px] transition-colors ${
    isActive ? 'font-semibold text-ink' : 'font-normal text-mut hover:text-ink'
  }`

/**
 * A module's icon, with a red dot at its corner when something on that
 * module's screens is late or blocked. The dot says "look here"; the counts
 * themselves are on the subpages, seen once the section is unfolded.
 */
function NavIcon({ kind, active, dot = false }: { kind: string; active: boolean; dot?: boolean }) {
  const Icon = navIcons[kind] ?? LayoutDashboard
  return (
    <span className="relative inline-flex shrink-0">
      <Icon size={15} strokeWidth={1.8} className={active ? 'text-ink' : 'text-faint'} />
      {dot && (
        <span aria-hidden className="absolute -left-[4px] -top-[3px] h-[7px] w-[7px] rounded-full bg-redf ring-2 ring-sidebar" />
      )}
    </span>
  )
}

/**
 * Active marker: a 2px rule bleeding off the sidebar's left padding.
 *
 * Ink rather than the accent. The nav now says "you are here" entirely in
 * weight and darkness, and a coloured tick was the one thing still shouting it
 * in a second language. It also frees the accent to mean one thing on a screen:
 * something you can act on.
 */
/**
 * The count beside a row: how many things on that screen are late or
 * blocked. Red, the same as the bell's count: these are the things that
 * need someone today.
 */
function NavPill({ n }: { n: number }) {
  if (n <= 0) return null
  return (
    <span className="tnum ml-auto inline-flex h-[17px] min-w-[17px] shrink-0 items-center justify-center rounded-full bg-redf px-[5px] font-meta text-[10.5px] font-semibold leading-none text-white">
      {n > 99 ? '99' : n}
    </span>
  )
}

function ActiveTick() {
  return <span className="absolute -left-[10px] top-2 bottom-2 w-[2px] rounded-r-[2px] bg-ink" />
}

/**
 * Which sections are unfolded. A section unfolds itself when you are inside
 * it, and stays as you left it otherwise - clicking a module with subpages
 * opens or closes its list without leaving the page you are on. Remembered
 * per browser; a module with no subpages is just a link.
 */
const OPEN_KEY = 'nav.open'
function useOpenSections(pathname: string): [Set<string>, (to: string) => void] {
  const [open, setOpen] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(OPEN_KEY) ?? '[]') as string[]) } catch { return new Set() }
  })
  const here = sectionOf(pathname)
  useEffect(() => {
    if (here && !open.has(here)) setOpen((prev) => new Set(prev).add(here))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [here])
  const toggle = (to: string) => setOpen((prev) => {
    const next = new Set(prev)
    if (next.has(to)) next.delete(to); else next.add(to)
    try { localStorage.setItem(OPEN_KEY, JSON.stringify([...next])) } catch { /* per-browser convenience only */ }
    return next
  })
  return [open, toggle]
}

/** The nav item whose section a path is in - "/" only exactly, since every
 * path starts with it. */
function sectionOf(pathname: string): string | null {
  let best: NavItem | null = null
  for (const item of nav) {
    const inside = item.to === '/'
      ? pathname === '/' || (item.children ?? []).some((c) => c.to !== '/' && (pathname === c.to || pathname.startsWith(`${c.to}/`)))
      : pathname === item.to || pathname.startsWith(`${item.to}/`) || pathname.startsWith(`${item.to}?`)
    if (inside && (!best || item.to.length > best.to.length)) best = item
  }
  return best?.to ?? null
}

/**
 * One nav row. With subpages it is a fold: the row opens and closes the list
 * and the subpages are the links. Without them it is the link itself.
 */
function SidebarItem({ item, isAdmin, open, onToggle, badges }: {
  item: NavItem; isAdmin: boolean; open: boolean; onToggle: () => void; badges: NavBadges
}) {
  const { pathname } = useLocation()
  const inSection = sectionOf(pathname) === item.to
  const children = (item.children ?? []).filter((c) => !c.adminOnly || isAdmin)
  const total = badgeFor(badges, item.to, children)

  if (children.length === 0) {
    return (
      <NavLink to={item.to} end={item.to === '/'} className={({ isActive }) => navItemCls(isActive)}>
        {({ isActive }) => (
          <>
            {isActive && <ActiveTick />}
            <NavIcon kind={item.icon} active={isActive} dot={total > 0} />
            {item.label}
            <NavPill n={total} />
          </>
        )}
      </NavLink>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={`${navItemCls(inSection)} w-full cursor-pointer border-0 bg-transparent text-left`}
      >
        {inSection && <ActiveTick />}
        {/* Folded, the dot says something inside needs looking at; open, the
            subpages carry the numbers and the dot stays as the reminder. */}
        <NavIcon kind={item.icon} active={inSection} dot={total > 0} />
        {item.label}
        <ChevronDown size={13} strokeWidth={2} className={`ml-auto shrink-0 text-faint transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      <div className={`fold ${open ? 'open' : ''}`}>
        <div className="mb-[2px] flex flex-col">
          {children.map((c) => (
            <NavLink
              key={c.to}
              to={c.to}
              tabIndex={open ? 0 : -1}
              // `end` so Levels at /inventory is not lit up while you are on
              // /inventory/purchases, which shares its prefix.
              end
              className={({ isActive }) =>
                `flex items-center rounded-[6px] py-[5px] pl-[33px] pr-2 text-[13px] transition-colors ${
                  isActive ? 'font-semibold text-ink' : 'font-normal text-mut hover:text-ink'
                }`
              }
            >
              {c.label}
              <NavPill n={badges[c.to] ?? 0} />
            </NavLink>
          ))}
        </div>
      </div>
    </>
  )
}

/**
 * The approvals queue, in the rail.
 *
 * It sits with Home rather than in a group because it is not one: Operations,
 * Revenue and People are parts of the business, and this is a job. It was
 * reachable only through a Needs attention row, the notification bell, or by
 * typing /settings/approvals - which meant an approver had no way to see that
 * something was waiting without something else telling them first.
 *
 * The count is the point. A queue whose badge is empty needs no visit, and one
 * that is not empty says how much work is in it before you click.
 *
 * Shown only to seats that can decide. A staff member's own submissions are
 * their own queue, but it is a thing they check rarely - it stays where it was,
 * on the module screens they already work in.
 */
function ApprovalsNavItem() {
  const { seat } = useAuth()
  const mayApprove = Boolean(seat?.isAdmin || seat?.canApprove)
  const { data } = useApprovals('pending', !mayApprove)
  if (!mayApprove) return null
  const waiting = data?.pendingCount ?? 0

  return (
    <NavLink to="/settings/approvals" end className={({ isActive }) => navItemCls(isActive)}>
      {({ isActive }) => (
        <>
          {isActive && <ActiveTick />}
          <NavIcon kind="approvals" active={isActive} />
          Approvals
          {waiting > 0 && (
            <NavPill n={waiting} />
          )}
        </>
      )}
    </NavLink>
  )
}

function SidebarProfile() {
  const navigate = useNavigate()
  const { seat, logout } = useAuth()
  // closed → open → closing → closed. The menu stays mounted through
  // `closing` so the exit animation has something to play on; animationend
  // (or the reduced-motion fallback timer) takes it out.
  const [phase, setPhase] = useState<'closed' | 'open' | 'closing'>('closed')
  const open = phase === 'open'
  const ref = useRef<HTMLDivElement>(null)

  const close = () => setPhase((p) => (p === 'open' ? 'closing' : p))
  const toggle = () => setPhase((p) => (p === 'open' ? 'closing' : 'open'))

  useEffect(() => {
    if (phase !== 'open') return
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') close() }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onKey) }
  }, [phase])

  // Under prefers-reduced-motion the exit animation is `none` and never ends,
  // so a short timer is the backstop that actually unmounts the menu.
  useEffect(() => {
    if (phase !== 'closing') return
    const t = window.setTimeout(() => setPhase('closed'), 160)
    return () => window.clearTimeout(t)
  }, [phase])

  // Navigating away or logging out: let the menu play out while the page changes.
  const pick = (fn: () => void) => { close(); fn() }

  if (!seat) return null
  const initials = seat.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()

  const item = 'menu-item flex w-full cursor-pointer items-center gap-[10px] rounded-[6px] border-0 bg-transparent px-[8px] py-[7px] text-left text-[13px] text-lab transition-colors hover:bg-fill2'

  return (
    <div ref={ref} className="relative">
      <button
        onClick={toggle}
        className={`mt-[2px] flex w-full cursor-pointer items-center gap-[9px] rounded-[6px] px-2 py-[7px] text-left transition-colors hover:bg-[#ebedef] ${open ? 'bg-[#ebedef]' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-fill2 font-meta text-[12px] font-semibold text-sec">
          {initials}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold leading-[1.2]">{seat.name}</span>
          <span className="block truncate font-meta text-[12px] leading-[1.3] text-mut">
            {seat.role}{seat.isAdmin ? ' · Admin' : ''}
          </span>
        </span>
        <ChevronDown size={13} strokeWidth={2} className={`shrink-0 text-faint transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {phase !== 'closed' && (
        <div
          role="menu"
          onAnimationEnd={(e) => { if (phase === 'closing' && e.target === e.currentTarget) setPhase('closed') }}
          className={`${phase === 'closing' ? 'menu-down' : 'menu-up'} absolute bottom-[calc(100%+8px)] left-0 z-[950] w-full min-w-[220px] rounded-[10px] border border-line bg-white p-[6px] shadow-[0_10px_32px_rgba(20,24,27,.16)]`}
        >
          {/* Who is signed in, so the menu reads as this person's rather than
              a list of links: name, and the username the seat signs in with. */}
          <div className="menu-item mb-[4px] flex items-center gap-[10px] border-b border-linesoft px-[8px] pb-[9px] pt-[4px]">
            <span className="flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-full bg-tealbadge font-meta text-[13px] font-semibold text-tealtext">
              {initials}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-semibold leading-[1.2]">{seat.name}</span>
              <span className="block truncate font-meta text-[11.5px] leading-[1.3] text-mut">@{seat.username} · {seat.role}{seat.isAdmin ? ' · Admin' : ''}</span>
            </span>
          </div>
          {canAccess(seat, 'settings') && (
            <button role="menuitem" onClick={() => pick(() => navigate('/settings'))} className={item}>
              <SettingsIcon size={15} strokeWidth={1.8} className="shrink-0 text-faint" />
              Admin &amp; settings
            </button>
          )}
          {/* Every seat may open it - the server returns only that seat's own
              rows to a non-admin - and it was reachable by URL alone. */}
          <button role="menuitem" onClick={() => pick(() => navigate('/settings/history'))} className={item}>
            <History size={15} strokeWidth={1.8} className="shrink-0 text-faint" />
            Input history
          </button>
          <div className="menu-item my-[4px] border-t border-linesoft" aria-hidden />
          <button role="menuitem" onClick={() => pick(logout)} className={`${item} text-redtext hover:bg-redbadge/60`}>
            <LogOut size={15} strokeWidth={1.8} className="shrink-0" />
            Log out
          </button>
        </div>
      )}
    </div>
  )
}

function TopBar() {
  const today = new Date().toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' })

  return (
    <div className="sticky top-0 z-[900] flex items-center gap-3 border-b border-line bg-white px-[18px] py-2">
      {/* Global search, parked.
       *
       * This was a div containing a span: not an input, no click handler, and no
       * keyboard listener anywhere in the app. It could not be typed into, and
       * the ⌘K badge advertised a shortcut that did not exist. Because it
       * changed its placeholder per route it read as a working control, which is
       * worse than having none.
       *
       * The per-page filters are the real thing and are untouched (see the
       * "Supplier or PO number…" input on Stock).
       *
       * To bring it back it needs to become a genuine command palette: an input
       * or a dialog trigger, a ⌘K keydown listener, and a search across sales,
       * customers, purchases, trucks and employees returning deep links via
       * recordHref(). Restore `searchHints` and the `Search` import below at the
       * same time. Wiring ⌘K to a single page's filter is not enough - the
       * shortcut conventionally means "search everything", so scoping it to one
       * table would still mislead.
       */}
      {/*
      <div className="flex w-[300px] max-w-[38%] items-center gap-2 rounded-[6px] border border-transparent bg-fill2 py-[5px] pl-[10px] pr-2 font-meta text-[12px] text-mut transition-colors hover:border-inputline hover:bg-white">
        <Search size={13} strokeWidth={2} color="currentColor" />
        <span className="truncate">{searchHints[path] ?? 'Search…'}</span>
        <span className="ml-auto shrink-0 text-[10px] font-semibold text-faint">⌘K</span>
      </div>
      */}
      {/* Global chrome only. The create action moved into each page's own
          header - it changed with the route, so it never belonged in the frame
          that does not. */}
      <span className="ml-auto font-meta text-[12px] text-mut">{today}</span>
      <NotificationBell />
    </div>
  )
}

function Sidebar() {
  const { seat } = useAuth()
  const { pathname } = useLocation()
  const [open, toggle] = useOpenSections(pathname)
  // The counts beside the rows. Each table only for a seat whose modules
  // would show that row, so a dispatcher's sidebar never fetches sales.
  const money = canAccess(seat, 'sales') || canAccess(seat, 'collection') || canAccess(seat, 'treasury') || canAccess(seat, 'inventory')
  const sales = useTableIf('sales', money)
  const purchases = useTableIf('purchases', canAccess(seat, 'inventory') || canAccess(seat, 'treasury'))
  const deliveries = useTableIf('deliveries', canAccess(seat, 'logistics'))
  const stockThresholds = useTableIf('stockThresholds', canAccess(seat, 'inventory'))
  const badges = useMemo(() => navBadges({ sales, purchases, deliveries, stockThresholds }), [sales, purchases, deliveries, stockThresholds])
  const visible = nav.filter((item) => canAccess(seat, item.module))
  const home = visible.find((item) => !item.group)
  const grouped = groupOrder
    .map((group) => ({ group, items: visible.filter((item) => item.group === group) }))
    .filter((g) => g.items.length > 0)

  return (
    <aside className="fixed inset-y-0 left-0 z-[1100] box-border flex w-[212px] flex-col border-r border-line bg-sidebar px-[10px] pb-[10px] pt-[14px]">
      <div className="flex items-center gap-[9px] px-[6px] pb-4 pt-[2px]">
        <img src={logo} alt="" className="h-[26px] w-[26px] shrink-0 rounded-[6px] bg-ink object-contain p-[3px]" />
        <div className="min-w-0">
          <p className="m-0 truncate text-[13px] font-semibold leading-[1.2]">MPower</p>
          <p className="m-0 truncate font-meta text-[12px] leading-[1.3] text-mut">Diesel Trading</p>
        </div>
      </div>

      {/* The list scrolls on its own; the profile below it does not. With
          every section unfolded the rail is taller than a laptop screen, and
          the account control was the thing that went off the bottom. */}
      <nav className="-mx-[10px] min-h-0 flex-1 overflow-y-auto px-[10px] pb-[8px] [scrollbar-width:thin]">
        {home && <SidebarItem item={home} isAdmin={!!seat?.isAdmin} open={open.has(home.to)} onToggle={() => toggle(home.to)} badges={badges} />}

        <ApprovalsNavItem />

        {grouped.map(({ group, items }) => (
          <div key={group} className="mt-4">
            <p className="m-0 px-2 pb-[5px] font-meta text-[10px] font-semibold uppercase tracking-[.09em] text-faint">
              {group}
            </p>
            {items.map((item) => (
              <SidebarItem key={item.to} item={item} isAdmin={!!seat?.isAdmin} open={open.has(item.to)} onToggle={() => toggle(item.to)} badges={badges} />
            ))}
          </div>
        ))}
      </nav>

      <div className="shrink-0 border-t border-line pt-[10px]">
        <SidebarProfile />
      </div>
    </aside>
  )
}

/** Offered once, to admins, when the shared database is empty but this browser still has
 * records from the old local-only version of the app - one click publishes them to D1
 * so they become the data everyone sees. */
function PublishBanner() {
  const { seat } = useAuth()
  const [legacy, setLegacy] = useState<Record<string, unknown[]> | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  const status = useQuery({
    queryKey: ['status'],
    queryFn: () => api<{ seats: number; records: number }>('/status'),
    refetchInterval: false,
  })

  useEffect(() => {
    readLegacyLocalData().then(setLegacy).catch(() => setLegacy(null))
  }, [])

  if (!seat?.isAdmin || dismissed || done || !legacy || status.data === undefined || status.data.records > 0) return null

  async function publish() {
    if (!legacy) return
    setBusy(true)
    try {
      await api('/import', { method: 'POST', body: { tables: legacy } })
      await queryClient.invalidateQueries()
      setDone(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-3 border-b border-line bg-inkcard px-[18px] py-[10px] text-white">
      <UploadCloud size={16} strokeWidth={1.8} className="shrink-0" />
      <p className="m-0 flex-1 text-[13px]">
        The shared database is empty, but this browser still has <b>{countRecords(legacy).toLocaleString()} records</b> from
        the old local version - publish them so your whole team sees this data?
      </p>
      <button
        onClick={publish}
        disabled={busy}
        className="cursor-pointer rounded-[4px] bg-white px-3 py-[5px] font-meta text-[12px] font-semibold text-ink hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? 'Publishing…' : 'Publish data'}
      </button>
      <button
        onClick={() => setDismissed(true)}
        className="cursor-pointer rounded-[4px] border border-white/25 bg-transparent px-3 py-[5px] font-meta text-[12px] font-semibold text-white hover:bg-white/10"
      >
        Not now
      </button>
    </div>
  )
}

/** Blocks direct URLs to modules this seat wasn't given - bounces to their first allowed screen. */
function Guard({ module, admin, children }: { module: ModuleKey; admin?: boolean; children: ReactNode }) {
  const { seat } = useAuth()
  if (!canAccess(seat, module)) return <Navigate to={homePath(seat) ?? '/'} replace />
  if (admin && !seat?.isAdmin) return <Navigate to="/hr" replace />
  return children
}

function CalendarGuard({ children }: { children: ReactNode }) {
  const { seat } = useAuth()
  if (layersFor(seat).length === 0) return <Navigate to={homePath(seat) ?? '/'} replace />
  return children
}

/** Shown to a seat that was saved with no modules ticked - nothing to display, only way out is logging out. */
function NoAccess() {
  const { logout } = useAuth()
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-paper p-6 text-center">
      <p className="m-0 text-[20px] font-semibold tracking-[-0.02em]">No module access</p>
      <p className="m-0 max-w-[360px] text-[13px] text-mut">
        This seat has not been assigned any modules. Please contact an administrator to update its access.
      </p>
      <button
        onClick={logout}
        className="mt-1 cursor-pointer rounded-[6px] border border-inputline bg-white px-4 py-[7px] text-[13px] font-semibold text-lab hover:bg-fill2"
      >
        Log out
      </button>
    </div>
  )
}

/**
 * The page body, faded in once per navigation. Keyed on the path so a move
 * between modules re-runs the entrance; a query-string change within one
 * (a drawer opening) does not.
 */
/**
 * The tab bar, which steps out of the way while the keyboard is up: fixed
 * to the bottom, it rode up on top of the keyboard and sat between the
 * person and the field they were typing into (the dock and the floating
 * button do the same - see field/shell.tsx). The bar's height is a variable
 * on the root, because the floating button and the sheets render into
 * <body>; it goes to zero with the bar so nothing keeps a gap for a bar
 * that isn't there.
 */
function FieldBar({ pages, seat }: { pages: { path: string; label: string }[]; seat: { id: string } }) {
  const keyboard = useKeyboardOpen()
  useEffect(() => {
    document.documentElement.style.setProperty('--field-bar-h', keyboard || pages.length <= 1 ? '0px' : '68px')
    return () => { document.documentElement.style.removeProperty('--field-bar-h') }
  }, [keyboard, pages.length])
  if (pages.length <= 1) return null
  return (
    <nav
      className={`fixed inset-x-0 bottom-0 z-[700] flex h-[68px] items-start border-t border-line bg-white pt-[9px] transition-transform duration-150 motion-reduce:transition-none ${keyboard ? 'translate-y-full' : ''}`}
      aria-hidden={keyboard}
    >
      {pages.map((p) => (
        <FieldTab
          key={p.path}
          to={p.path}
          label={p.label}
          // Named per path rather than falling through to a truck: a
          // collector's round is not a delivery, and the fallback was
          // quietly putting a lorry on it.
          icon={
            p.path === '/my/sales' ? <Banknote size={22} strokeWidth={1.8} />
            : p.path === '/my/collections' ? <HandCoins size={22} strokeWidth={1.8} />
            : p.path === '/my/tasks' ? <CheckSquare size={22} strokeWidth={1.8} />
            : <Truck size={22} strokeWidth={1.8} />
          }
          badge={p.path === '/my/tasks' ? <OpenTasksBadge seatId={seat.id} /> : null}
        />
      ))}
    </nav>
  )
}

function Fade({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  return <div key={pathname} className="fade-in">{children}</div>
}

function Shell() {
  const { seat, ready } = useAuth()

  if (!ready) return null
  if (!seat) return <Login />
  const home = homePath(seat)
  if (!home) return <NoAccess />

  /**
   * The field shell: no sidebar, no to-do rail, one column.
   *
   * A pahinante reads this at a depot gate on a phone, where a fixed 212px
   * sidebar leaves about 180px of page - and every nav row in it goes to a
   * screen whose tables they have no rows of. They get their own screens and
   * nothing else, which is also the only honest thing to show a seat the server
   * is filtering this hard.
   */
  if (hasFieldShell(seat)) {
    const pages = fieldPages(seat)
    return (
      <ToastProvider>
        <Tooltips />
        {/* The shell is only the frame now: each field screen draws its own
            header, because the date and the screen's name belong to the screen
            and the account control belongs beside them. What is left here is
            the page itself and, for a seat that holds more than one field
            screen, the bar to move between them. */}
        <FieldBar pages={pages} seat={seat} />
        <div className="min-h-screen bg-paper pb-[var(--field-bar-h,0px)]">
          <div className="mx-auto box-border w-full max-w-[560px] pb-[16px]">
            <Fade>
            <Routes>
              <Route path="/my/trips" element={<Guard module="logistics"><MyTrips /></Guard>} />
              <Route path="/my/sales" element={<Guard module="sales"><MySales /></Guard>} />
              <Route path="/my/collections" element={<Guard module="collection"><MyCollections /></Guard>} />
              {/* Not module-gated: every field seat has a list. */}
              <Route path="/my/tasks" element={<MyTasks />} />
              <Route path="*" element={<Navigate to={home} replace />} />
            </Routes>
            </Fade>
          </div>

        </div>
      </ToastProvider>
    )
  }

  return (
    <RangeProvider>
      <ToastProvider>
        <Tooltips />
      <PeekProvider>
      <RecordPeek />
      <QuickCreateProvider>
        <div className="min-h-screen">
          <Sidebar />
          <TodoRail />
          {/* The rail is fixed, so it publishes its width as --todo-rail-w and
              the content reserves that much room. Collapsing the rail widens
              the page rather than letting the panel float over it. */}
          <div className="ml-[212px] transition-[margin] duration-150" style={{ marginRight: 'var(--todo-rail-w, 0px)' }}>
            <PublishBanner />
            <TopBar />
            <div className="box-border max-w-[1340px] p-[18px]">
              <Fade>
              <Routes>
                <Route path="/" element={<Guard module="dashboard"><Dashboard /></Guard>} />
                {/* Gated by what it can show rather than by Home: a dispatcher
                    with no Home module still has trips and the fleet to see. */}
                <Route path="/calendar" element={<CalendarGuard><CalendarPage /></CalendarGuard>} />
                <Route path="/inventory" element={<Guard module="inventory"><Inventory page="levels" /></Guard>} />
                <Route path="/inventory/purchases" element={<Guard module="inventory"><Inventory page="purchases" /></Guard>} />
                <Route path="/inventory/movements" element={<Guard module="inventory"><Inventory page="movements" /></Guard>} />
                <Route path="/inventory/warnings" element={<Guard module="inventory"><Inventory page="warnings" /></Guard>} />
                <Route path="/sales" element={<Guard module="sales"><Sales /></Guard>} />
                <Route path="/collection" element={<Guard module="collection"><Collection page="queue" /></Guard>} />
                <Route path="/collection/calendar" element={<Guard module="collection"><Collection page="calendar" /></Guard>} />
                <Route path="/collection/balances" element={<Guard module="collection"><Collection page="balances" /></Guard>} />
                <Route path="/collection/collectors" element={<Guard module="collection"><Collection page="collectors" /></Guard>} />
                <Route path="/treasury" element={<Guard module="treasury"><Treasury page="deposits" /></Guard>} />
                <Route path="/treasury/clearing" element={<Guard module="treasury"><Treasury page="clearing" /></Guard>} />
                <Route path="/treasury/payables" element={<Guard module="treasury"><Treasury page="payables" /></Guard>} />
                <Route path="/accounts" element={<Guard module="accounts"><Accounts page="customers" /></Guard>} />
                <Route path="/accounts/suppliers" element={<Guard module="accounts"><Accounts page="suppliers" /></Guard>} />
                <Route path="/logistics" element={<Guard module="logistics"><Logistics page="board" /></Guard>} />
                <Route path="/logistics/maintenance" element={<Guard module="logistics"><Logistics page="maintenance" /></Guard>} />
                <Route path="/logistics/bans" element={<Guard module="logistics"><Logistics page="bans" /></Guard>} />
                <Route path="/hr" element={<Guard module="hr"><Hr page="attendance" /></Guard>} />
                <Route path="/hr/leaves" element={<Guard module="hr"><Hr page="leaves" /></Guard>} />
                <Route path="/hr/payroll" element={<Guard module="hr"><Hr page="payroll" /></Guard>} />
                <Route path="/hr/employees" element={<Guard module="hr"><Hr page="employees" /></Guard>} />
                <Route path="/hr/performance" element={<Guard module="hr"><Hr page="kpi" /></Guard>} />
                <Route path="/hr/drug-tests" element={<Guard module="hr"><Hr page="drugTests" /></Guard>} />
                {/* Setup writes hr.* settings and the shifts/holidays tables, which the
                    API restricts to admins. Guarded here too so a typed URL does not
                    present an editor whose every save would be refused. */}
                <Route path="/hr/setup" element={<Guard module="hr" admin><Hr page="setup" /></Guard>} />
                <Route path="/settings" element={<Guard module="settings"><Settings /></Guard>} />
                {/* Secondary Features 2.1 and 2.2. Not behind the settings module
                    guard: any seat may see its own pending inputs and its own
                    entry history - the server decides what each seat can read. */}
                <Route path="/settings/approvals" element={<Approvals />} />
                <Route path="/settings/history" element={<InputHistory />} />
                <Route path="*" element={<Navigate to={home} replace />} />
              </Routes>
              </Fade>
            </div>
          </div>
        </div>
      </QuickCreateProvider>
      </PeekProvider>
      </ToastProvider>
    </RangeProvider>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  )
}

/** One field screen in the phone bar. NavLink so the active one is derived
 *  from the URL rather than tracked in a second place. */
function FieldTab({ to, label, icon, badge }: { to: string; label: string; icon: ReactNode; badge?: ReactNode }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex flex-1 flex-col items-center gap-[3px] font-meta text-[11px] font-semibold no-underline transition-colors ${
          isActive ? 'text-ink' : 'text-faint'
        }`
      }
    >
      <span className="relative flex h-[22px] items-center leading-none">
        <span aria-hidden>{icon}</span>
        {badge}
      </span>
      {label}
    </NavLink>
  )
}

/** Open items on the seat's list, sat on the tab icon. Nothing when zero:
 *  a "0" badge is a badge asking to be looked at with nothing to show. */
function OpenTasksBadge({ seatId }: { seatId: string }) {
  const todos = useTable('todos')
  const n = openTaskCount(todos, seatId)
  if (n === 0) return null
  return (
    <span
      key={n}
      aria-label={`${n} open`}
      className="task-pop tnum absolute -right-[10px] -top-[6px] flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-redf px-[4px] font-meta text-[10px] font-bold leading-none text-white"
    >
      {n > 99 ? '99+' : n}
    </span>
  )
}
