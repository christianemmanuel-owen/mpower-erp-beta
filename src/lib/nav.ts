import { Boxes, ClipboardCheck, HandCoins, IdCard, LayoutDashboard, Receipt, Settings as SettingsIcon, Truck, Users } from 'lucide-react'
import type { ModuleKey } from '../data/types'

/**
 * The nav rail's contents, as data.
 *
 * Extracted from App so it can be asserted against without importing the whole
 * application (and, through it, the map library, which needs a DOM). The test
 * that matters here checks that every screen a module renders is actually named
 * in this list: HR shipped two finished pages - KPI and Drug tests - that the
 * module rendered but no nav entry mentioned, so nothing in the app could open
 * either of them.
 */
export type NavGroup = 'Operations' | 'Revenue' | 'People'

export interface NavChild {
  to: string
  label: string
  /** Hidden from seats that are not admins. The page itself must still guard
   * its own writes; this only keeps a useless row out of the sidebar. */
  adminOnly?: boolean
}

export interface NavItem {
  to: string
  label: string
  icon: string
  module: ModuleKey
  group?: NavGroup
  /**
   * Subpages, shown indented beneath this item only while you are inside it.
   *
   * A module big enough to scroll is better split than tabbed: a tab loses your
   * place on every visit and cannot be linked to. Children fold away when you
   * navigate elsewhere so the sidebar stays short as Sales, Collection and HR
   * get the same treatment.
   */
  children?: NavChild[]
}

/** Exported so a test can check that every subpage a module renders is actually
 * listed here. HR shipped two finished screens - KPI and Drug tests - that were
 * rendered by the module but named in no nav entry, so nothing in the app could
 * open either of them. */
export const nav: NavItem[] = [
  { to: '/', label: 'Home', icon: 'home', module: 'dashboard' },
  {
    to: '/inventory', label: 'Stock', icon: 'stock', module: 'inventory', group: 'Operations',
    children: [
      { to: '/inventory', label: 'Levels' },
      { to: '/inventory/purchases', label: 'Purchases' },
      { to: '/inventory/movements', label: 'Movements' },
      { to: '/inventory/warnings', label: 'Warnings', adminOnly: true },
    ],
  },
  {
    to: '/logistics', label: 'Trips', icon: 'trips', module: 'logistics', group: 'Operations',
    children: [
      { to: '/logistics', label: 'Board' },
      { to: '/logistics/maintenance', label: 'Maintenance' },
      { to: '/logistics/bans', label: 'Truck bans' },
    ],
  },
  { to: '/sales', label: 'Sales', icon: 'sales', module: 'sales', group: 'Revenue' },
  {
    to: '/collection', label: 'Collect', icon: 'collect', module: 'collection', group: 'Revenue',
    children: [
      { to: '/collection', label: 'Queue' },
      { to: '/collection/calendar', label: 'Calendar' },
      { to: '/collection/balances', label: 'Balances' },
      { to: '/collection/collectors', label: 'Collectors' },
    ],
  },
  {
    to: '/accounts', label: 'Accounts', icon: 'accounts', module: 'accounts', group: 'Revenue',
    children: [
      { to: '/accounts', label: 'Customers' },
      { to: '/accounts/suppliers', label: 'Suppliers' },
    ],
  },
  {
    to: '/hr', label: 'HR', icon: 'hr', module: 'hr', group: 'People',
    children: [
      { to: '/hr', label: 'Attendance' },
      { to: '/hr/leaves', label: 'Leaves' },
      { to: '/hr/payroll', label: 'Payroll' },
      { to: '/hr/employees', label: 'Employees' },
      { to: '/hr/performance', label: 'Performance' },
      { to: '/hr/drug-tests', label: 'Drug tests' },
      { to: '/hr/setup', label: 'Setup', adminOnly: true },
    ],
  },
]

/** The icon that means each module. One map, so the rail and anything that links
 * into a module (the Needs attention rows) show the same mark for the same place. */
export const navIcons: Record<string, typeof LayoutDashboard> = {
  home: LayoutDashboard,
  stock: Boxes,
  sales: Receipt,
  collect: HandCoins,
  accounts: Users,
  trips: Truck,
  hr: IdCard,
  approvals: ClipboardCheck,
  settings: SettingsIcon,
}

/**
 * Which module a path belongs to, by longest matching nav entry.
 *
 * Longest-first matters: '/inventory/warnings' has to resolve through the
 * Stock entry rather than stopping at the first prefix that happens to fit.
 * Settings has no nav entry of its own - it lives in the footer - so it is
 * matched here explicitly rather than falling through to nothing.
 */
export function moduleForPath(path: string): { icon: typeof LayoutDashboard; label: string } {
  // Checked before the generic /settings prefix: the approvals queue has its
  // own rail entry now, so a link into it should carry its own mark.
  if (path.startsWith('/settings/approvals')) return { icon: navIcons.approvals, label: 'Approvals' }
  if (path.startsWith('/settings')) return { icon: navIcons.settings, label: 'Settings' }
  let best: NavItem | null = null
  for (const item of nav) {
    if (path === item.to || path.startsWith(item.to === '/' ? '/@never' : `${item.to}/`) || path.startsWith(`${item.to}?`)) {
      if (!best || item.to.length > best.to.length) best = item
    }
  }
  if (!best) return { icon: navIcons.home, label: 'Home' }
  return { icon: navIcons[best.icon] ?? navIcons.home, label: best.label }
}
