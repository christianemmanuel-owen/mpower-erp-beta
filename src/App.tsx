import { useEffect, useRef, useState, type ReactNode } from 'react'
import { nav, navIcons, type NavGroup, type NavItem } from './lib/nav'
import { NavLink, Navigate, Route, Routes, useMatch, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { LayoutDashboard, Settings as SettingsIcon, ChevronDown, LogOut, UploadCloud } from 'lucide-react'
import { ToastProvider } from './components/Toast'
import { RangeProvider } from './lib/range'
import { QuickCreateProvider } from './lib/quickCreate'
import { AuthProvider, canAccess, homePath, useAuth } from './lib/auth'
import { useApprovals } from './lib/approvals'
import { api } from './lib/api'
import { queryClient } from './lib/queryClient'
import { countRecords, readLegacyLocalData } from './lib/migrate'
import type { ModuleKey } from './data/types'
import Login from './modules/auth/Login'
import Dashboard from './modules/dashboard/Dashboard'
import Inventory from './modules/inventory/Inventory'
import Sales from './modules/sales/Sales'
import Collection from './modules/collection/Collection'
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

function NavIcon({ kind, active }: { kind: string; active: boolean }) {
  const Icon = navIcons[kind] ?? LayoutDashboard
  return <Icon size={15} strokeWidth={1.8} className={active ? 'text-ink' : 'text-faint'} />
}

/**
 * Active marker: a 2px rule bleeding off the sidebar's left padding.
 *
 * Ink rather than the accent. The nav now says "you are here" entirely in
 * weight and darkness, and a coloured tick was the one thing still shouting it
 * in a second language. It also frees the accent to mean one thing on a screen:
 * something you can act on.
 */
function ActiveTick() {
  return <span className="absolute -left-[10px] top-2 bottom-2 w-[2px] rounded-r-[2px] bg-ink" />
}

/**
 * One nav row, plus its subpages when you are inside it.
 *
 * `useMatch` rather than NavLink's own isActive, because the parent needs to
 * know it is active in order to decide whether to render children at all, and
 * NavLink only hands that down inside its own render prop.
 */
function SidebarItem({ item, isAdmin }: { item: NavItem; isAdmin: boolean }) {
  const inSection = !!useMatch({ path: item.to, end: false })
  const children = (item.children ?? []).filter((c) => !c.adminOnly || isAdmin)

  return (
    <>
      <NavLink to={item.to} className={({ isActive }) => navItemCls(isActive || inSection)}>
        {({ isActive }) => (
          <>
            {(isActive || inSection) && <ActiveTick />}
            <NavIcon kind={item.icon} active={isActive || inSection} />
            {item.label}
          </>
        )}
      </NavLink>
      {inSection && children.length > 0 && (
        <div className="mb-[2px] flex flex-col">
          {children.map((c) => (
            <NavLink
              key={c.to}
              to={c.to}
              // `end` so Levels at /inventory is not lit up while you are on
              // /inventory/purchases, which shares its prefix.
              end
              className={({ isActive }) =>
                `rounded-[6px] py-[5px] pl-[33px] pr-2 text-[13px] transition-colors ${
                  isActive ? 'font-semibold text-ink' : 'font-normal text-mut hover:text-ink'
                }`
              }
            >
              {c.label}
            </NavLink>
          ))}
        </div>
      )}
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
            <span className="tnum ml-auto rounded-[10px] bg-ink px-[6px] py-[1px] font-meta text-[11px] font-semibold text-white">
              {waiting}
            </span>
          )}
        </>
      )}
    </NavLink>
  )
}

function SidebarProfile() {
  const navigate = useNavigate()
  const { seat, logout } = useAuth()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  if (!seat) return null
  const initials = seat.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="mt-[2px] flex w-full cursor-pointer items-center gap-[9px] rounded-[6px] px-2 py-[7px] text-left transition-colors hover:bg-[#ebedef]"
        aria-haspopup="true"
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
        <ChevronDown size={13} strokeWidth={2} className="shrink-0 text-faint" />
      </button>
      {open && (
        <div className="absolute bottom-[calc(100%+6px)] left-0 z-[950] w-full min-w-[188px] rounded-[8px] border border-line bg-white py-[6px] shadow-[0_8px_28px_rgba(20,24,27,.14)]">
          {canAccess(seat, 'settings') && (
            <button
              onClick={() => { setOpen(false); navigate('/settings') }}
              className="flex w-full cursor-pointer items-center gap-[9px] px-3 py-[7px] text-left text-[13px] text-lab hover:bg-fill2"
            >
              <SettingsIcon size={15} strokeWidth={1.8} className="text-faint" />
              Admin &amp; settings
            </button>
          )}
          <button
            onClick={() => { setOpen(false); logout() }}
            className="flex w-full cursor-pointer items-center gap-[9px] px-3 py-[7px] text-left text-[13px] text-redtext hover:bg-fill2"
          >
            <LogOut size={15} strokeWidth={1.8} />
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

      {home && (
        <NavLink to={home.to} end className={({ isActive }) => navItemCls(isActive)}>
          {({ isActive }) => (
            <>
              {isActive && <ActiveTick />}
              <NavIcon kind={home.icon} active={isActive} />
              {home.label}
            </>
          )}
        </NavLink>
      )}

      <ApprovalsNavItem />

      {grouped.map(({ group, items }) => (
        <div key={group} className="mt-4">
          <p className="m-0 px-2 pb-[5px] font-meta text-[10px] font-semibold uppercase tracking-[.09em] text-faint">
            {group}
          </p>
          {items.map((item) => (
            <SidebarItem key={item.to} item={item} isAdmin={!!seat?.isAdmin} />
          ))}
        </div>
      ))}

      <div className="mt-auto border-t border-line pt-[10px]">
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

/** Shown to a seat that was saved with no modules ticked - nothing to display, only way out is logging out. */
function NoAccess() {
  const { seat, logout } = useAuth()
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-paper p-6 text-center">
      <p className="m-0 text-[20px] font-semibold tracking-[-0.02em]">No modules assigned</p>
      <p className="m-0 max-w-[360px] text-[13px] text-mut">
        {seat?.name}, your seat has no module access yet. Ask an admin to assign modules to your seat.
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

function Shell() {
  const { seat, ready } = useAuth()

  if (!ready) return null
  if (!seat) return <Login />
  const home = homePath(seat)
  if (!home) return <NoAccess />

  return (
    <RangeProvider>
      <ToastProvider>
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
              <Routes>
                <Route path="/" element={<Guard module="dashboard"><Dashboard /></Guard>} />
                <Route path="/inventory" element={<Guard module="inventory"><Inventory page="levels" /></Guard>} />
                <Route path="/inventory/purchases" element={<Guard module="inventory"><Inventory page="purchases" /></Guard>} />
                <Route path="/inventory/movements" element={<Guard module="inventory"><Inventory page="movements" /></Guard>} />
                <Route path="/inventory/warnings" element={<Guard module="inventory"><Inventory page="warnings" /></Guard>} />
                <Route path="/sales" element={<Guard module="sales"><Sales /></Guard>} />
                <Route path="/collection" element={<Guard module="collection"><Collection page="queue" /></Guard>} />
                <Route path="/collection/calendar" element={<Guard module="collection"><Collection page="calendar" /></Guard>} />
                <Route path="/collection/balances" element={<Guard module="collection"><Collection page="balances" /></Guard>} />
                <Route path="/collection/collectors" element={<Guard module="collection"><Collection page="collectors" /></Guard>} />
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
            </div>
          </div>
        </div>
      </QuickCreateProvider>
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
