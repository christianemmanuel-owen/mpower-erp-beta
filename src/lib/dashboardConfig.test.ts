import { describe, expect, it } from 'vitest'
import {
  ALL_WIDGETS, WIDGET_MODULE, configForRole, orderWidgets, reorderWithinGroup, resolveWidgets, seatMaySee,
  widgetShower, withWidgetsAddedSince,
} from './dashboardConfig'
import { DEFAULT_DASHBOARD_WIDGETS } from '../data/types'
import type { DashboardConfig, DashboardWidget, ModuleKey, Seat } from '../data/types'

const seat = (over: Partial<Seat> = {}): Seat => ({
  id: 'seat1', createdAt: '', updatedAt: '',
  name: 'Someone', username: 'someone', role: 'Encoder',
  isAdmin: false, modules: [], ...over,
})

/** A config as the roles screen saves one today: it records the full widget
 * set it was offered, so an omission is a decision rather than an accident of
 * when it was written. Legacy configs, which carry no `knownWidgets`, are
 * built inline in the tests that are about them. */
const config = (role: string, widgets: DashboardWidget[]): DashboardConfig => ({
  id: `cfg-${role}`, createdAt: '', updatedAt: '', role, widgets,
  knownWidgets: [...ALL_WIDGETS],
})

describe('seatMaySee', () => {
  it('lets anyone see a widget that belongs to no module', () => {
    expect(seatMaySee(seat({ modules: [] }), 'todos')).toBe(true)
    expect(seatMaySee(seat({ modules: [] }), 'announcements')).toBe(true)
  })

  it('requires the matching module for module-bound widgets', () => {
    const salesOnly = seat({ modules: ['sales'] })
    expect(seatMaySee(salesOnly, 'agentQuota')).toBe(true)
    expect(seatMaySee(salesOnly, 'receivables')).toBe(false)
    expect(seatMaySee(salesOnly, 'stockByWarehouse')).toBe(false)
  })

  it('lets an admin see everything, matching the access-control layer', () => {
    const admin = seat({ isAdmin: true, modules: [] })
    for (const w of ALL_WIDGETS) expect(seatMaySee(admin, w)).toBe(true)
  })

  it('shows nothing module-bound to a missing seat', () => {
    expect(seatMaySee(null, 'receivables')).toBe(false)
  })
})

describe('configForRole', () => {
  const configs = [config('Dispatcher', ['deliveryBoard'])]

  it('matches a role case-insensitively and ignoring surrounding space', () => {
    expect(configForRole(configs, 'dispatcher')?.id).toBe('cfg-Dispatcher')
    expect(configForRole(configs, '  DISPATCHER ')?.id).toBe('cfg-Dispatcher')
  })

  it('returns nothing for an unconfigured role', () => {
    expect(configForRole(configs, 'Encoder')).toBeUndefined()
    expect(configForRole(configs, undefined)).toBeUndefined()
  })
})

describe('resolveWidgets', () => {
  it('falls back to the default view when the role has no config', () => {
    const admin = seat({ isAdmin: true, role: 'Owner' })
    expect(resolveWidgets(admin, [])).toEqual(DEFAULT_DASHBOARD_WIDGETS)
  })

  it('uses the role config when one exists', () => {
    const s = seat({ role: 'Dispatcher', modules: ['logistics'] })
    const configs = [config('Dispatcher', ['deliveryBoard', 'kpis', 'todos'])]
    expect(resolveWidgets(s, configs)).toEqual(['deliveryBoard', 'kpis', 'todos'])
  })

  it('honours the configured order, so a role can lead with what it cares about', () => {
    const s = seat({ isAdmin: true, role: 'Owner' })
    const configs = [config('Owner', ['receivables', 'kpis', 'todos'])]
    expect(resolveWidgets(s, configs)).toEqual(['receivables', 'kpis', 'todos'])
  })

  // ---- the rule that matters ------------------------------------------------

  it('never grants a widget the seat has no module access for', () => {
    // An administrator ticking "receivables" for a Logistics role must not leak
    // collection figures to a seat the access layer excluded.
    const dispatcher = seat({ role: 'Dispatcher', modules: ['logistics'] })
    const configs = [config('Dispatcher', ['deliveryBoard', 'receivables', 'cashFlow'])]
    expect(resolveWidgets(dispatcher, configs)).toEqual(['deliveryBoard'])
  })

  it('narrows the default view too, not just configured ones', () => {
    // The default list names sales and stock widgets; a seat with neither module
    // should still see only what it may.
    const s = seat({ role: 'Nobody', modules: [] })
    const resolved = resolveWidgets(s, [])
    expect(resolved).not.toContain('agentQuota')
    expect(resolved).not.toContain('stockByWarehouse')
    expect(resolved).toContain('todos')
  })

  it('drops an unknown widget name rather than rendering a blank', () => {
    const s = seat({ isAdmin: true, role: 'Owner' })
    const configs = [config('Owner', ['kpis', 'somethingRemoved' as DashboardWidget, 'todos'])]
    expect(resolveWidgets(s, configs)).toEqual(['kpis', 'todos'])
  })

  it('shows an empty dashboard rather than falling back when a config is deliberately empty', () => {
    // An empty config is a choice; treating it as "unconfigured" would silently
    // override the administrator.
    const s = seat({ isAdmin: true, role: 'Owner' })
    expect(resolveWidgets(s, [config('Owner', [])])).toEqual([])
  })

  it('does not read an old empty config as having declined widgets it never saw', () => {
    // The mirror of the case above, and the distinction `knownWidgets` exists
    // to draw. This config predates the field, so its emptiness says nothing
    // about anything shipped since.
    const s = seat({ isAdmin: true, role: 'Owner' })
    const legacy = { id: 'c', role: 'Owner', createdAt: '', updatedAt: '', widgets: [] } as unknown as DashboardConfig
    expect(resolveWidgets(s, [legacy])).toContain('needsAttention')
  })

  it('gives an admin every configured widget regardless of their module list', () => {
    const admin = seat({ isAdmin: true, role: 'Owner', modules: [] })
    const configs = [config('Owner', ['receivables', 'stockByWarehouse', 'deliveryBoard'])]
    expect(resolveWidgets(admin, configs)).toHaveLength(3)
  })
})

describe('widgetShower', () => {
  it('answers membership for the resolved set', () => {
    const show = widgetShower(['kpis', 'todos'])
    expect(show('kpis')).toBe(true)
    expect(show('receivables')).toBe(false)
  })
})

describe('widget metadata', () => {
  it('labels and maps every widget, so none can be silently unconfigurable', () => {
    for (const w of ALL_WIDGETS) {
      expect(WIDGET_MODULE).toHaveProperty(w)
    }
    expect(ALL_WIDGETS.length).toBeGreaterThan(0)
  })

  it('only maps widgets onto real modules', () => {
    const valid: ModuleKey[] = ['dashboard', 'inventory', 'sales', 'collection', 'accounts', 'logistics', 'hr', 'settings']
    for (const w of ALL_WIDGETS) {
      const m = WIDGET_MODULE[w]
      if (m !== null) expect(valid).toContain(m)
    }
  })
})

/**
 * orderWidgets is the boundary between a seat's taste and its access. These
 * cases are the reason it exists: a saved arrangement must never be able to put
 * back a widget the seat is no longer permitted, and must never swallow one it
 * has newly been granted.
 */
describe('orderWidgets', () => {
  const allowed: DashboardWidget[] = ['kpis', 'boughtVsSold', 'recentTransactions']

  it('returns the allowed list untouched when there is no personal layout', () => {
    expect(orderWidgets(allowed, undefined)).toEqual(allowed)
    expect(orderWidgets(allowed, [])).toEqual(allowed)
  })

  it('applies the seat\'s order', () => {
    expect(orderWidgets(allowed, ['boughtVsSold', 'recentTransactions', 'kpis']))
      .toEqual(['boughtVsSold', 'recentTransactions', 'kpis'])
  })

  it('drops a widget the seat may no longer see, however the layout orders it', () => {
    // 'receivables' is not in `allowed` - access control or the role config has
    // removed it since the layout was saved. A stale layout must not resurrect it.
    const result = orderWidgets(allowed, ['receivables', 'boughtVsSold', 'kpis', 'recentTransactions'])
    expect(result).not.toContain('receivables')
    expect(result).toEqual(['boughtVsSold', 'kpis', 'recentTransactions'])
  })

  it('never widens: the result is always a subset of what was allowed', () => {
    const result = orderWidgets(allowed, ALL_WIDGETS)
    for (const w of result) expect(allowed).toContain(w)
    expect(result).toHaveLength(allowed.length)
  })

  it('appends a newly permitted widget rather than hiding it', () => {
    // The layout predates the seat gaining 'recentTransactions'.
    expect(orderWidgets(allowed, ['boughtVsSold', 'kpis']))
      .toEqual(['boughtVsSold', 'kpis', 'recentTransactions'])
  })

  it('is a permutation - no duplicates, nothing lost', () => {
    const result = orderWidgets(allowed, ['recentTransactions', 'recentTransactions', 'kpis'])
    expect(new Set(result).size).toBe(result.length)
    expect([...result].sort()).toEqual([...allowed].sort())
  })
})

/**
 * The dashboard keeps one flat order across all four tabs but lets you reorder
 * within the tab you are on. The bug this guards against is the obvious
 * implementation: splice the flat list and watch cards from other tabs shuffle.
 */
describe('reorderWithinGroup', () => {
  // a = Overview, b/c = Operations, d = Cash flow, e = Operations
  const all = ['a', 'b', 'c', 'd', 'e']
  const ops = (x: string) => ['b', 'c', 'e'].includes(x)

  it('moves an item within its group and leaves the other slots alone', () => {
    // b, c, e -> c, b, e. The slots occupied by Operations are 1, 2 and 4.
    expect(reorderWithinGroup(all, ops, 0, 1)).toEqual(['a', 'c', 'b', 'd', 'e'])
  })

  it('moves an item across a slot belonging to another group', () => {
    // b, c, e -> c, e, b. 'd' must stay at index 3 throughout.
    const out = reorderWithinGroup(all, ops, 0, 2)
    expect(out).toEqual(['a', 'c', 'e', 'd', 'b'])
    expect(out[3]).toBe('d')
  })

  it('never disturbs the members of other groups', () => {
    for (let from = 0; from < 3; from++) {
      for (let to = 0; to < 3; to++) {
        const out = reorderWithinGroup(all, ops, from, to)
        expect(out[0]).toBe('a')
        expect(out[3]).toBe('d')
        expect([...out].sort()).toEqual([...all].sort())
      }
    }
  })

  it('returns the list untouched for a move that goes nowhere or out of range', () => {
    expect(reorderWithinGroup(all, ops, 1, 1)).toBe(all)
    expect(reorderWithinGroup(all, ops, -1, 0)).toBe(all)
    expect(reorderWithinGroup(all, ops, 0, 3)).toBe(all)
  })

  it('copes with a group of one, and with no group at all', () => {
    expect(reorderWithinGroup(all, (x) => x === 'a', 0, 0)).toBe(all)
    expect(reorderWithinGroup(all, () => false, 0, 1)).toBe(all)
  })
})

describe('a retired widget key', () => {
  it('drops out of a stored config without taking the rest with it', () => {
    // 'lowStock' was retired when the Depots card absorbed it. A role
    // configured before that still names it, and the admin who wrote that
    // config should keep everything else they ticked.
    const configs = [{
      id: 'c1', role: 'Dispatcher', createdAt: '', updatedAt: '',
      widgets: ['kpis', 'lowStock', 'needsAttention'],
    }] as unknown as DashboardConfig[]
    const seat = { isAdmin: true, modules: [], role: 'Dispatcher' } as unknown as Seat
    const result = resolveWidgets(seat, configs)
    expect(result).not.toContain('lowStock')
    expect(result).toContain('kpis')
    expect(result).toContain('needsAttention')
  })
})

describe('a widget added after a role was configured', () => {
  /** The config actually found on the deployment, written before Home was
   * restructured. It is the reason this behaviour exists. */
  const ownerConfig = {
    id: 'c1', role: 'Owner', createdAt: '', updatedAt: '',
    widgets: [
      'kpis', 'stockByWarehouse', 'agentQuota', 'recentTransactions', 'lowStock',
      'truckEta', 'deliveryBoard', 'cashFlow', 'receivables', 'todos', 'announcements', 'approvals',
    ],
  } as unknown as DashboardConfig

  it('reaches the role instead of being treated as declined', () => {
    const result = withWidgetsAddedSince(ownerConfig)
    expect(result).toContain('needsAttention')
    expect(result).toContain('volumeSold')
    expect(result).toContain('boughtVsSold')
    expect(result).toContain('incoming')
  })

  it('still drops the keys that were retired', () => {
    const seat = { isAdmin: true, modules: [], role: 'Owner' } as unknown as Seat
    const result = resolveWidgets(seat, [ownerConfig])
    // Absorbed into the Depots card and the Movements card respectively.
    expect(result).not.toContain('lowStock')
    expect(result).not.toContain('truckEta')
  })

  it('lands where the default layout puts it, not on the end', () => {
    // Appending would leave a half-width card alone in its row, which is the
    // dead space the block packer exists to avoid.
    const result = withWidgetsAddedSince(ownerConfig)
    expect(result.indexOf('needsAttention')).toBe(result.indexOf('kpis') + 1)
    expect(result.indexOf('volumeSold')).toBe(result.indexOf('needsAttention') + 1)
    expect(result.indexOf('incoming')).toBe(result.indexOf('stockByWarehouse') + 1)
    expect(result.indexOf('boughtVsSold')).toBe(result.indexOf('deliveryBoard') + 1)
  })

  it('leaves the administrator\'s own ordering alone', () => {
    const result = withWidgetsAddedSince(ownerConfig)
    const kept = result.filter((w) => ownerConfig.widgets.includes(w))
    expect(kept).toEqual(ownerConfig.widgets)
  })

  it('puts the Operations blocks in an order that packs into rows', () => {
    const seat = { isAdmin: true, modules: [], role: 'Owner' } as unknown as Seat
    const operations = resolveWidgets(seat, [ownerConfig])
      .filter((w) => ['stockByWarehouse', 'incoming', 'deliveryBoard', 'boughtVsSold'].includes(w))
    // Depots and Incoming are the half-width pair; the other two are full.
    expect(operations).toEqual(['stockByWarehouse', 'incoming', 'deliveryBoard', 'boughtVsSold'])
  })

  it('puts the Overview blocks in an order that packs into rows', () => {
    const seat = { isAdmin: true, modules: [], role: 'Owner' } as unknown as Seat
    const overview = resolveWidgets(seat, [ownerConfig])
      .filter((w) => ['kpis', 'needsAttention', 'volumeSold', 'announcements'].includes(w))
    // The two half-width blocks must end up adjacent, or each runs full width.
    expect(overview).toEqual(['kpis', 'needsAttention', 'volumeSold', 'announcements'])
  })

  it('respects an unticked box once the config records what it was offered', () => {
    const deliberate = {
      ...ownerConfig,
      widgets: ['kpis', 'announcements'],
      knownWidgets: [...ALL_WIDGETS],
    } as unknown as DashboardConfig
    // Nothing is new to this config, so nothing is added back.
    expect(withWidgetsAddedSince(deliberate)).toEqual(['kpis', 'announcements'])
  })

  it('does not re-add something the config already names', () => {
    const partly = { ...ownerConfig, widgets: [...ownerConfig.widgets, 'needsAttention'] } as unknown as DashboardConfig
    const result = withWidgetsAddedSince(partly)
    expect(result.filter((w) => w === 'needsAttention')).toHaveLength(1)
  })
})
