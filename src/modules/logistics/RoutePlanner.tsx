import { useEffect, useRef, useState } from 'react'
import { Clock, MapPin, Search } from 'lucide-react'
import { Dialog, GhostButton, PrimaryButton } from '../../components/ui'
import MapPicker, { type RouteLine } from '../../components/MapPicker'
import { api } from '../../lib/api'
import { fmtHours, suggestedHours } from '../../lib/logistics'
import type { GeoPoint, TravelEstimate } from '../../data/types'
import { zonesCrossed } from '../../lib/zones'

/**
 * The trip's route, planned on a map - laid out the way Google Maps lays
 * out directions: a panel on the left with the two ends stacked and joined
 * by a dotted line, the ways there listed under them with the road each
 * follows and its time, the chosen one marked with a bar at its edge; and
 * the map filling everything else, edge to edge, with the chosen route
 * bold and the rest faint.
 *
 * The destination is the pin. It starts wherever the address geocodes to
 * and can be dragged to the actual gate, which is often the difference
 * between the right street and the right yard. Typing a different address
 * in the panel moves the pin there and re-plans.
 *
 * The one number nobody can route is how long the truck sits at the
 * customer, so that is the one number to adjust; everything else in the
 * whole-trip total follows from the chosen route.
 */
interface RouteOption { minutes: number; km: number; summary: string; line: [number, number][] }
interface Estimate {
  provider: 'google' | 'osrm'
  from: string
  to: string
  origin: GeoPoint & { label: string }
  destination: GeoPoint & { label: string }
  routes: RouteOption[]
  at: string
}

export default function RoutePlanner({ origin, address, destination, unloadMinutes = 30, leaves, onClose, onUse }: {
  origin: { label: string; query: string; point?: GeoPoint }
  address: string
  /** Where the pin was last time, if anyone placed it. */
  destination?: GeoPoint
  /** Minutes at the customer last time, if set. */
  unloadMinutes?: number
  /** "Mon Sep 21 · 08:00" - context, shown in the panel, not editable here. */
  leaves?: string
  onClose: () => void
  onUse: (r: { estimate: TravelEstimate; destination: GeoPoint; hours: number; address: string }) => void
}) {
  const [pin, setPin] = useState<GeoPoint | null>(destination ?? null)
  const [query, setQuery] = useState(address)
  const [est, setEst] = useState<Estimate | null>(null)
  const [chosen, setChosen] = useState(0)
  const [loading, setLoading] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [unload, setUnload] = useState(unloadMinutes)
  const seq = useRef(0)

  // Routes for a place: a pin's coordinates, or an address the server
  // geocodes - in which case the pin moves to where it lands.
  async function plan(to: string, placePin: boolean) {
    const mine = ++seq.current
    setLoading(true); setProblem(null)
    try {
      const r = await api<Estimate>(`/route-estimate?from=${encodeURIComponent(origin.query)}&to=${encodeURIComponent(to)}`)
      if (mine !== seq.current) return
      setEst(r); setChosen(0)
      if (placePin) setPin({ lat: r.destination.lat, lng: r.destination.lng })
    } catch (e) {
      if (mine !== seq.current) return
      setProblem(e instanceof Error ? e.message : 'Couldn’t plan the route.')
    } finally {
      if (mine === seq.current) setLoading(false)
    }
  }
  useEffect(() => { void plan(pin ? `${pin.lat},${pin.lng}` : address, !pin) /* eslint-disable-line react-hooks/exhaustive-deps */ }, [])

  // A pin dropped by hand: plan from it at once; when the geocoder names
  // the spot a moment later, the address follows the pin.
  const movePin = (p: GeoPoint, lbl?: string) => {
    if (lbl) { setQuery(lbl); return }
    setPin(p); void plan(`${p.lat},${p.lng}`, false)
  }
  const findAddress = () => { if (query.trim()) void plan(query.trim(), true) }

  const originPoint = est?.origin ?? origin.point ?? null
  const routes = est?.routes ?? []
  const lines: RouteLine[] = routes.map((r, i) => ({
    points: r.line,
    chosen: i === chosen,
    label: fmtHours(r.minutes / 60),
    onClick: () => setChosen(i),
  }))
  const pick = routes[chosen]
  const exact = pick ? (pick.minutes * 2 + unload + 15) / 60 : null
  const total = pick ? suggestedHours(pick.minutes, unload) : null

  return (
    <Dialog
      open
      flush
      title="Plan the route"
      onClose={onClose}
      width={1040}
      footer={
        <>
          <span className="mr-auto font-meta text-[12px] text-mut">
            {pick && total !== null ? `Truck tied up about ${fmtHours(total)}.` : ''}
          </span>
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton
            disabled={!pick || !pin}
            onClick={() => {
              if (!pick || !pin || !est) return
              onUse({
                estimate: { minutesOneWay: pick.minutes, km: pick.km, provider: est.provider, from: est.from, to: est.to, at: est.at, summary: pick.summary || undefined, routeIndex: chosen, unloadMinutes: unload, zones: zonesCrossed(pick.line) },
                destination: pin,
                hours: suggestedHours(pick.minutes, unload),
                address: query.trim(),
              })
            }}
          >
            Use this route
          </PrimaryButton>
        </>
      }
    >
      {/* Left: the directions panel. */}
      <div className="flex w-[340px] shrink-0 flex-col overflow-y-auto border-r border-linesoft">
        {/* The two ends, joined. The origin is fixed; the destination is a
            search box, so a wrong address is fixed here rather than by
            closing the planner. */}
        <div className="border-b border-linesoft px-[16px] pb-[14px] pt-[14px]">
          <div className="grid grid-cols-[18px_1fr] gap-x-[10px]">
            <span className="flex flex-col items-center pt-[10px]">
              <span className="h-[10px] w-[10px] rounded-full border-[2.5px] border-teal bg-white" />
              <span className="my-[3px] w-0 flex-1 border-l border-dotted border-inputline" />
              <MapPin size={16} strokeWidth={2.2} className="text-redtext" />
            </span>
            <div className="flex flex-col gap-[8px]">
              <div className="flex h-[36px] items-center rounded-[8px] bg-fill2 px-[12px]">
                <span className="truncate text-[13px] font-semibold">{origin.label}</span>
                <span className="ml-auto shrink-0 font-meta text-[11px] text-faint">depot</span>
              </div>
              <form onSubmit={(e) => { e.preventDefault(); findAddress() }} className="relative">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label="Destination address"
                  placeholder="Where the fuel is going"
                  className="ctl h-[36px] w-full rounded-[8px] border border-inputline bg-white pl-[12px] pr-[34px] font-[inherit] text-[13px] font-semibold focus:border-teal focus:outline-none"
                />
                <button
                  type="submit"
                  aria-label="Find this address on the map"
                  data-tip="Find on the map"
                  className="absolute right-[4px] top-[4px] flex h-[28px] w-[28px] cursor-pointer items-center justify-center rounded-[6px] border-0 bg-transparent text-mut hover:bg-fill2 hover:text-ink"
                >
                  <Search size={14} strokeWidth={2.2} />
                </button>
              </form>
            </div>
          </div>
          <p className="m-0 mt-[8px] pl-[28px] font-meta text-[11.5px] text-mut">
            {pin ? 'Drag the pin on the map to the exact gate.' : 'No pin yet - find the address or click the map.'}
          </p>
          {leaves && (
            <p className="m-0 mt-[6px] flex items-center gap-[6px] pl-[28px] font-meta text-[12px] text-sec">
              <Clock size={12} strokeWidth={2} className="text-mut" /> Leaves {leaves}
            </p>
          )}
        </div>

        {/* The ways there, fastest first. */}
        <div className="px-[6px] py-[6px]">
          {problem && <p className="m-0 mx-[10px] my-[6px] rounded-[8px] border border-redf bg-redbadge px-[10px] py-[8px] font-meta text-[12px] font-semibold text-redtext">{problem}</p>}
          {loading && routes.length === 0 && <p className="m-0 px-[10px] py-[10px] font-meta text-[12px] text-mut">Finding the ways there…</p>}
          <ul className="m-0 list-none p-0" aria-label="Route options">
            {routes.map((r, i) => {
              const on = i === chosen
              return (
                <li key={i}>
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => setChosen(i)}
                    className={`relative flex w-full cursor-pointer items-start gap-[10px] rounded-[8px] border-0 px-[12px] py-[10px] text-left transition-colors ${
                      on ? 'bg-tealbadge/60' : 'bg-transparent hover:bg-fill2'
                    }`}
                  >
                    {on && <span aria-hidden className="absolute bottom-[8px] left-0 top-[8px] w-[3px] rounded-r-[2px] bg-teal" />}
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-[13px] leading-[1.3] ${on ? 'font-semibold text-ink' : 'font-semibold text-sec'}`}>
                        {r.summary ? cap(r.summary) : `Route ${i + 1}`}
                      </span>
                      <span className="block font-meta text-[12px] text-mut">
                        {i === 0 ? 'Fastest' : `+${fmtHours((r.minutes - routes[0].minutes) / 60)}`} · {r.km} km
                      </span>
                    </span>
                    <span className={`tnum shrink-0 text-[15px] font-semibold leading-[1.3] ${on ? 'text-tealtext' : 'text-ink'}`}>
                      {fmtHours(r.minutes / 60)}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
          {routes.length > 0 && (
            <p className="m-0 px-[12px] pb-[4px] pt-[6px] font-meta text-[11.5px] text-faint">
              {loading ? 'Re-planning for the moved pin…' : 'Times are one way.'}
            </p>
          )}
        </div>

        {/* The whole trip, at the foot of the panel. */}
        {pick && total !== null && exact !== null && (
          <div className="mt-auto border-t border-linesoft bg-paper px-[16px] py-[12px]">
            <div className="flex items-baseline justify-between">
              <span className="font-meta text-[11px] font-semibold uppercase tracking-[.08em] text-mut">Whole trip</span>
              <span className="tnum text-[18px] font-semibold leading-none">{fmtHours(exact)}</span>
            </div>
            <dl className="m-0 mt-[8px] grid grid-cols-[1fr_auto] gap-y-[4px] font-meta text-[12px]">
              <dt className="text-mut">Drive there</dt><dd className="tnum m-0 text-right">{fmtHours(pick.minutes / 60)}</dd>
              <dt className="text-mut">Unloading</dt>
              <dd className="m-0 flex items-center justify-end gap-[4px]">
                <input
                  type="number" min={0} step={5} value={unload} aria-label="Minutes to unload"
                  onChange={(e) => setUnload(Math.max(0, Number(e.target.value) || 0))}
                  className="ctl tnum h-[24px] w-[56px] rounded-[6px] border border-inputline bg-white px-[6px] text-right font-meta text-[12px] focus:border-teal focus:outline-none"
                />
                <span className="text-mut">min</span>
              </dd>
              <dt className="text-mut">Drive back</dt><dd className="tnum m-0 text-right">{fmtHours(pick.minutes / 60)}</dd>
              <dt className="text-mut">Slack</dt><dd className="tnum m-0 text-right">15m</dd>
            </dl>
            {Math.abs(exact - total) > 0.01 && (
              <p className="m-0 mt-[8px] border-t border-linesoft pt-[6px] font-meta text-[11.5px] text-mut">
                Booked as <span className="tnum font-semibold text-ink">{fmtHours(total)}</span>, rounded up to the half hour.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Right: the map, edge to edge. */}
      <div className="relative min-w-0 flex-1">
        <MapPicker
          value={pin}
          onChange={movePin}
          origin={originPoint ? { ...originPoint, label: origin.label } : null}
          routes={lines}
          height="100%"
          search={false}
          frame={false}
        />
        {est && (
          <span className="pointer-events-none absolute bottom-[10px] left-[10px] z-[500] rounded-full bg-white/92 px-[9px] py-[3px] font-meta text-[11px] font-medium text-sec shadow-[0_1px_3px_rgba(20,24,27,.14)]">
            {est.provider === 'google' ? 'Google Maps · with traffic' : 'OpenStreetMap · no traffic'}
          </span>
        )}
      </div>
    </Dialog>
  )
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
