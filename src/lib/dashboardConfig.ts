import { DEFAULT_DASHBOARD_WIDGETS, WIDGETS_BEFORE_HOME_RESTRUCTURE } from '../data/types'
import type { DashboardConfig, DashboardWidget, ModuleKey, Seat } from '../data/types'

/**
 * Per-role dashboard configuration - Exhibit A 1.1, "per-role dashboard
 * configuration, such that Sales, Logistics, employee, and managerial views may
 * differ".
 *
 * ## Configuration narrows; it never grants
 *
 * The one rule that matters. A widget appears only if the seat's **module
 * access** allows it AND the role's configuration includes it. An administrator
 * cannot hand a Logistics seat the receivables widget by ticking a box - that
 * would leak collection figures to someone the access-control layer has
 * deliberately excluded, and it would do so through a screen nobody thinks of as
 * a permission.
 *
 * Access control is the gate. This is a preference on top of it. Keeping those
 * two ideas apart is what stops a convenience feature becoming a data leak, and
 * it is why `resolveWidgets` takes the seat rather than just the role name.
 *
 * ## Roles are free text
 *
 * A seat's `role` is a label an administrator types ("Owner", "Encoder",
 * "Dispatcher"). Configs are keyed by that string, case-insensitively, so a
 * config can be written for a role before anyone is assigned to it and picked up
 * automatically when they are. A seat whose role has no config gets
 * `DEFAULT_DASHBOARD_WIDGETS` - the same view the app has always shown, so
 * introducing this feature changes nothing until someone configures something.
 */

/** The module a widget's data belongs to. `null` means it is safe for anyone:
 * a to-do list is the seat's own, announcements are already audience-filtered,
 * and the approvals strip only ever shows the seat's own parked inputs. */
export const WIDGET_MODULE: Record<DashboardWidget, ModuleKey | null> = {
  kpis: null,
  // Needs attention reads across every module, so it cannot be gated on one.
  // It filters its own rows against the seat's modules instead - the same
  // arrangement the cash calendar and the approvals strip already use, and the
  // reason `null` here does not mean "unguarded".
  needsAttention: null,
  volumeSold: 'sales',
  stockByWarehouse: 'inventory',
  boughtVsSold: 'inventory',
  agentQuota: 'sales',
  recentTransactions: null,
  todos: null,
  incoming: 'inventory',
  deliveryBoard: 'logistics',
  receivables: 'collection',
  announcements: null,
  approvals: null,
}

export const WIDGET_LABELS: Record<DashboardWidget, string> = {
  kpis: 'Headline numbers',
  needsAttention: 'Needs attention',
  volumeSold: 'Volume sold',
  stockByWarehouse: 'Depots',
  boughtVsSold: 'Bought vs sold',
  agentQuota: 'Agent quota and ranking',
  recentTransactions: 'Recent transactions',
  todos: 'To-do list',
  incoming: 'Incoming purchases',
  deliveryBoard: 'Movements',
  receivables: 'Overdue receivables',
  announcements: 'Announcements',
  approvals: 'Awaiting approval',
}

export const ALL_WIDGETS = Object.keys(WIDGET_LABELS) as DashboardWidget[]

/**
 * Which tab each widget belongs to on the dashboard.
 *
 * A dashboard that answers four different questions on one scroll answers
 * none of them quickly. The categories are subjects rather than urgency, so a
 * card's tab is predictable: you learn once that trips live under Operations
 * and you never hunt for them again. Shared with the per-role editor so it
 * groups the widgets the way the dashboard shows them.
 */
export const DASHBOARD_TABS = ['Overview', 'Operations', 'Cash flow', 'Activity'] as const
export type DashboardTab = (typeof DASHBOARD_TABS)[number]

export const WIDGET_TAB: Record<DashboardWidget, DashboardTab> = {
  // `kpis` puts the band on screen and it sits in Overview with the volume
  // trend: both are forms of "how are we doing", which is what Overview is for.
  kpis: 'Overview',
  needsAttention: 'Overview',
  volumeSold: 'Overview',
  announcements: 'Overview',
  // Bought vs sold plots liters in against liters out, so it belongs with
  // stock rather than with money, and next to the Depots card it explains.
  stockByWarehouse: 'Operations',
  incoming: 'Operations',
  deliveryBoard: 'Operations',
  boughtVsSold: 'Operations',
  agentQuota: 'Cash flow',
  receivables: 'Cash flow',
  recentTransactions: 'Activity',
  approvals: 'Activity',
  // Lives in the side rail, so it contributes no blocks and needs no tab.
  todos: 'Activity',
}

/**
 * How much of a dashboard row a widget takes - what the editor's preview
 * draws. Kept in step with the `width` each widget's blocks declare in
 * Dashboard.tsx; a widget that renders two half cards is 'half' here because
 * that is how it packs.
 */
export const WIDGET_WIDTH: Record<DashboardWidget, 'full' | 'half' | 'rail'> = {
  kpis: 'full',
  needsAttention: 'full',
  volumeSold: 'half',
  announcements: 'half',
  stockByWarehouse: 'half',
  incoming: 'half',
  deliveryBoard: 'full',
  boughtVsSold: 'full',
  agentQuota: 'half',
  receivables: 'half',
  recentTransactions: 'full',
  approvals: 'full',
  todos: 'rail',
}

/**
 * A saved config plus any widget introduced after it was written.
 *
 * Configuring a role used to freeze it. `resolveWidgets` read a config as the
 * complete list, so a widget shipped afterwards could never appear on that
 * role's dashboard - it looked, from the seat's side, as though the feature
 * had not been built. Adding Needs attention is what surfaced it: the one
 * configured role on this deployment went on showing the old Home.
 *
 * An omission only counts as a refusal if the widget existed to be refused.
 * `knownWidgets` records what the config could see at save time, so unticking
 * still sticks; a config from before that field falls back to the historical
 * list. New widgets are placed by their position in the default layout rather
 * than appended, because the dashboard packs half-width blocks into rows in
 * order - appending would strand a card alone across the full page width.
 */
export function withWidgetsAddedSince(config: DashboardConfig): DashboardWidget[] {
  const known = new Set<string>(config.knownWidgets ?? WIDGETS_BEFORE_HOME_RESTRUCTURE)
  const chosen = new Set(config.widgets)
  const introduced = ALL_WIDGETS.filter((w) => !known.has(w) && !chosen.has(w))
  if (introduced.length === 0) return config.widgets

  const result = [...config.widgets]
  for (const widget of introduced) {
    // Slot it after whichever of its default-layout predecessors is already
    // present, so it lands where the default puts it without disturbing the
    // order an administrator chose for everything else.
    const defaultIndex = DEFAULT_DASHBOARD_WIDGETS.indexOf(widget)
    let at = result.length
    if (defaultIndex > 0) {
      for (let i = defaultIndex - 1; i >= 0; i--) {
        const found = result.indexOf(DEFAULT_DASHBOARD_WIDGETS[i])
        if (found !== -1) { at = found + 1; break }
      }
    } else if (defaultIndex === 0) {
      at = 0
    }
    result.splice(at, 0, widget)
  }
  return result
}

/** Does this seat's module access permit the widget at all? Admins see every
 * module, matching the access-control layer. */
export function seatMaySee(seat: Pick<Seat, 'isAdmin' | 'modules'> | null | undefined, widget: DashboardWidget): boolean {
  const required = WIDGET_MODULE[widget]
  if (required === null) return true
  if (!seat) return false
  if (seat.isAdmin) return true
  return (seat.modules ?? []).includes(required)
}

const norm = (role: string) => role.trim().toLowerCase()

/** The config for a role, matched case-insensitively. */
export function configForRole(configs: DashboardConfig[], role: string | undefined): DashboardConfig | undefined {
  if (!role) return undefined
  return configs.find((c) => norm(c.role) === norm(role))
}

/**
 * The widgets a seat should actually see, in display order.
 *
 * Order comes from the config, so an administrator can put what a Dispatcher
 * cares about at the top. The default list keeps its own order.
 */
export function resolveWidgets(
  seat: Pick<Seat, 'isAdmin' | 'modules' | 'role'> | null | undefined,
  configs: DashboardConfig[],
): DashboardWidget[] {
  const config = configForRole(configs, seat?.role)
  const wanted = config ? withWidgetsAddedSince(config) : DEFAULT_DASHBOARD_WIDGETS
  return wanted
    // A config written before a widget was removed, or hand-edited, can name
    // something unknown. Drop it rather than rendering a blank.
    .filter((w): w is DashboardWidget => ALL_WIDGETS.includes(w))
    .filter((w) => seatMaySee(seat, w))
}

/**
 * Apply a seat's own arrangement to the widgets it is allowed to see.
 *
 * The ordering is the seat's; the SET is not, and this function is where that
 * boundary is enforced. A personal layout can only permute `allowed`:
 *
 *   - a widget the layout names but the seat may no longer see is dropped, so a
 *     saved layout cannot resurrect something access control has since removed;
 *   - a widget the seat may see but the layout predates is appended rather than
 *     hidden, so a newly granted module shows up instead of silently vanishing.
 *
 * Both directions fail safe. Personal preference never widens access, and never
 * swallows something the role configuration added.
 */
export function orderWidgets(
  allowed: DashboardWidget[],
  personal: DashboardWidget[] | undefined,
): DashboardWidget[] {
  if (!personal || personal.length === 0) return allowed
  const permitted = new Set(allowed)
  // Deduplicated as well as filtered. A stored layout is just JSON and can name
  // the same widget twice - through a bad write, a merge, or a hand edit - and
  // that would otherwise render the widget twice and collide its React key.
  const seen = new Set<DashboardWidget>()
  const ordered: DashboardWidget[] = []
  for (const w of personal) {
    if (permitted.has(w) && !seen.has(w)) {
      seen.add(w)
      ordered.push(w)
    }
  }
  return [...ordered, ...allowed.filter((w) => !seen.has(w))]
}

/**
 * Reorder one group of items inside a flat list, leaving everything else where
 * it was.
 *
 * The dashboard stores a single ordered list across every tab, but the user
 * reorders within the tab they are looking at. So moving a card inside
 * Operations has to write the new order back into the slots Operations already
 * occupies, rather than splicing it into the flat list and dragging Cash flow
 * and Activity cards around with it.
 *
 * `from` and `to` are indices WITHIN the group, not within `all`.
 */
export function reorderWithinGroup<T>(
  all: T[],
  inGroup: (item: T) => boolean,
  from: number,
  to: number,
): T[] {
  const slots: number[] = []
  const members: T[] = []
  all.forEach((item, i) => {
    if (inGroup(item)) {
      slots.push(i)
      members.push(item)
    }
  })
  if (from < 0 || from >= members.length || to < 0 || to >= members.length || from === to) return all

  const reordered = [...members]
  reordered.splice(to, 0, ...reordered.splice(from, 1))

  const next = [...all]
  slots.forEach((slot, k) => { next[slot] = reordered[k] })
  return next
}

/** Convenience for the Dashboard: a predicate over the resolved set. */
export const widgetShower = (widgets: DashboardWidget[]) => {
  const set = new Set(widgets)
  return (w: DashboardWidget) => set.has(w)
}
