import { useMemo, useState } from 'react'
import { Card, PageHeader, PageSkeleton } from '../../components/ui'
import Planner, { type PlannerView } from '../../components/Planner'
import { useAuth, canAccess } from '../../lib/auth'
import { useTableIf, useTables } from '../../lib/data'
import { LAYERS, plannerEvents, type PlannerLayer } from '../../lib/planner'

/**
 * Home → Calendar: everything dated, week or month, layers to taste.
 *
 * Which layers a seat is offered follows its modules, the same way the
 * dashboard's cards do: a dispatcher sees trips and the fleet, a collector
 * sees what is due, the owner sees all of it. Leaves are the only HR data on
 * the page and are fetched only for a seat that may read them - see
 * useTableIf for why that matters.
 */

const PREF_KEY = 'planner.prefs'

interface Prefs { view: PlannerView; off: PlannerLayer[] }

function readPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREF_KEY)
    if (raw) return { view: 'month', off: [], ...(JSON.parse(raw) as Partial<Prefs>) }
  } catch {
    // Private mode, or a value from an older build: the defaults are fine.
  }
  return { view: 'month', off: [] }
}

function writePrefs(p: Prefs) {
  try { localStorage.setItem(PREF_KEY, JSON.stringify(p)) } catch { /* per-viewer convenience only */ }
}

/** Which layers this seat's modules earn it. */
export function layersFor(seat: ReturnType<typeof useAuth>['seat']): PlannerLayer[] {
  const out: PlannerLayer[] = []
  if (canAccess(seat, 'logistics')) out.push('trips', 'fleet')
  if (canAccess(seat, 'collection') || canAccess(seat, 'sales')) out.push('in')
  if (canAccess(seat, 'treasury') || canAccess(seat, 'collection')) out.push('bank')
  if (canAccess(seat, 'treasury') || canAccess(seat, 'inventory')) out.push('out')
  if (canAccess(seat, 'hr')) out.push('people')
  return LAYERS.map((l) => l.key).filter((k) => out.includes(k))
}

/** The layers a seat sees by default: all it may, minus what it switched off. */
export function usePlannerPrefs(offered: PlannerLayer[]) {
  const [prefs, setPrefs] = useState<Prefs>(readPrefs)
  const active = offered.filter((l) => !prefs.off.includes(l))
  const setActive = (next: PlannerLayer[]) => {
    const p = { ...prefs, off: offered.filter((l) => !next.includes(l)) }
    setPrefs(p)
    writePrefs(p)
  }
  const setView = (view: PlannerView) => {
    const p = { ...prefs, view }
    setPrefs(p)
    writePrefs(p)
  }
  return { active, setActive, view: prefs.view, setView }
}

export default function CalendarPage() {
  const { seat } = useAuth()
  const offered = useMemo(() => layersFor(seat), [seat])
  const { active, setActive, view, setView } = usePlannerPrefs(offered)

  const data = useTables(['sales', 'purchases', 'deliveries', 'customers', 'suppliers', 'trucks', 'personnel', 'vehicleMaintenance'] as const)
  const leaves = useTableIf('leaves', canAccess(seat, 'hr'))
  if (!data) return <PageSkeleton />

  const events = plannerEvents({ ...data, leaves: leaves ?? [] }, offered)

  return (
    <>
      <PageHeader
        title="Calendar"
        subtitle="Everything with a date on it - trips, money in and out, the fleet and the people - on one grid."
      />
      <Card className="p-[14px]" delay={50}>
        <Planner
          events={events}
          layers={offered}
          activeLayers={active}
          onLayers={setActive}
          view={view}
          onView={setView}
        />
      </Card>
    </>
  )
}
