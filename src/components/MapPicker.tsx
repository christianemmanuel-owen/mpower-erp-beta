import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import { Crosshair, Search } from 'lucide-react'
import { api } from '../lib/api'
import type { GeoPoint } from '../data/types'

/**
 * A map to put a pin on.
 *
 * Streets, not the trips map's bare coastline: placing a depot gate or a
 * customer's yard needs the roads around it. Click to drop the pin, drag it
 * to nudge it, or type an address and let the geocoder place it. The pin's
 * coordinates are the answer; the caller decides what to do with them.
 *
 * Also draws whatever route lines it is handed, so the trip planner can use
 * the same map for picking the destination and for showing the ways there.
 */
export interface RouteLine {
  points: [number, number][]
  /** The chosen one is drawn bold and on top; the rest faint. */
  chosen?: boolean
  label?: string
  onClick?: () => void
}

export const PIN_HTML = (color: string, label?: string) => `
  <span style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-100%)">
    <svg width="26" height="34" viewBox="0 0 26 34" fill="none"><path d="M13 33s11-10.4 11-19A11 11 0 0 0 2 14c0 8.6 11 19 11 19z" fill="${color}" stroke="#fff" stroke-width="2"/><circle cx="13" cy="14" r="4" fill="#fff"/></svg>
    ${label ? `<span style="margin-top:-2px;background:rgba(255,255,255,.94);border:1px solid #e5e8ea;border-radius:5px;padding:1px 6px;font-family:'IBM Plex Sans',sans-serif;font-size:11px;font-weight:600;color:#14181b;white-space:nowrap;box-shadow:0 1px 3px rgba(20,24,27,.14)">${label}</span>` : ''}
  </span>`

export default function MapPicker({ value, onChange, origin, routes = [], height = 360, placeholder = 'Type an address to place it', locked = false, initialQuery = '', search = true, frame = true, pinLabel = 'Delivery', reverse = true }: {
  value: GeoPoint | null
  /**
   * Called with the point at once, and again with the address once the
   * geocoder has named the spot - so the pin lands immediately and the
   * address field fills a moment later. A drop with no known address gets
   * only the first call.
   */
  onChange: (p: GeoPoint, label?: string) => void
  /** What the movable pin is called on the map - "Depot", "Delivery". */
  pinLabel?: string
  /** Look up the address of a dropped or dragged pin. Off where the caller
   * has no address field to fill. */
  reverse?: boolean
  /** A fixed second pin - the depot - drawn but not movable. */
  origin?: (GeoPoint & { label?: string }) | null
  routes?: RouteLine[]
  placeholder?: string
  /** Show only; no clicking or dragging. */
  locked?: boolean
  /** What the search box starts with - the address already typed elsewhere. */
  initialQuery?: string
  /** Without the search box, when the caller has its own address field. */
  search?: boolean
  /** Without the rounded border, when the map fills a panel edge to edge. */
  frame?: boolean
  height?: number | string
}) {
  const box = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const pin = useRef<L.Marker | null>(null)
  const originPin = useRef<L.Marker | null>(null)
  const lines = useRef<L.Polyline[]>([])
  // The last fit, re-run when the box changes size - a dialog that animates
  // open hands Leaflet a zero-size box at first, and a fit done then lands
  // everything miles off screen.
  const refit = useRef<() => void>(() => {})
  const [q, setQ] = useState(initialQuery)
  const [searching, setSearching] = useState(false)
  const [naming, setNaming] = useState(false)
  // Bumped each time the map is (re)built, so the pin, origin and route
  // effects run again against the new map. Under React's development
  // double-mount the first map is built, torn down and built again; the
  // pin had been added to the first one and was never seen again, so the
  // depot editor showed coordinates and no pin - in dev only.
  const [built, setBuilt] = useState(0)
  const [problem, setProblem] = useState<string | null>(null)
  // The latest callbacks, so the map built once still calls the current ones.
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const reverseRef = useRef(reverse)
  reverseRef.current = reverse
  const placing = useRef(0)

  /**
   * A pin placed by hand: report the point now, and the address when it
   * comes. Sequenced, so a second drop while the first lookup is out does
   * not get the first one's street.
   */
  async function place(p: GeoPoint) {
    onChangeRef.current(p)
    if (!reverseRef.current) return
    const mine = ++placing.current
    setNaming(true)
    try {
      const hit = await api<{ label: string }>(`/geocode/reverse?lat=${p.lat}&lng=${p.lng}`)
      if (mine !== placing.current) return
      onChangeRef.current(p, hit.label)
      setQ(hit.label)
    } catch {
      // No address for that spot - the pin still stands, the field stays.
    } finally {
      if (mine === placing.current) setNaming(false)
    }
  }

  // Build once.
  useEffect(() => {
    if (!box.current || map.current) return
    const m = L.map(box.current, { zoomControl: true, attributionControl: true })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(m)
    m.setView(value ? [value.lat, value.lng] : origin ? [origin.lat, origin.lng] : [14.6, 121.0], value || origin ? 13 : 10)
    if (!locked) {
      m.on('click', (e: L.LeafletMouseEvent) => void place({ lat: round(e.latlng.lat), lng: round(e.latlng.lng) }))
    }
    map.current = m
    setBuilt((n) => n + 1)
    const ro = new ResizeObserver(() => { m.invalidateSize(); refit.current() })
    ro.observe(box.current)
    return () => {
      ro.disconnect(); m.remove(); map.current = null
      // Everything that was on that map went with it.
      pin.current = null; originPin.current = null; lines.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The movable pin follows `value`.
  useEffect(() => {
    const m = map.current
    if (!m) return
    if (!value) { pin.current?.remove(); pin.current = null; return }
    if (!pin.current) {
      pin.current = L.marker([value.lat, value.lng], { draggable: !locked, icon: L.divIcon({ className: '', html: PIN_HTML(pinLabel === 'Depot' ? '#116a63' : '#b3261e', pinLabel), iconSize: [0, 0] }) }).addTo(m)
      pin.current.on('dragend', () => {
        const p = pin.current!.getLatLng()
        void place({ lat: round(p.lat), lng: round(p.lng) })
      })
    } else {
      pin.current.setLatLng([value.lat, value.lng])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, locked, pinLabel, built])

  // The origin pin.
  useEffect(() => {
    const m = map.current
    if (!m) return
    originPin.current?.remove(); originPin.current = null
    if (origin) {
      originPin.current = L.marker([origin.lat, origin.lng], { interactive: false, icon: L.divIcon({ className: '', html: PIN_HTML('#116a63', origin.label ?? 'Depot'), iconSize: [0, 0] }) }).addTo(m)
    }
  }, [origin, built])

  // Route lines, and a fit to everything on the map.
  useEffect(() => {
    const m = map.current
    if (!m) return
    for (const l of lines.current) l.remove()
    lines.current = []
    const drawn = [...routes].sort((a, b) => Number(a.chosen ?? false) - Number(b.chosen ?? false))
    for (const r of drawn) {
      if (r.points.length < 2) continue
      const casing = L.polyline(r.points, { color: '#fff', weight: r.chosen ? 9 : 6, opacity: r.chosen ? 1 : 0.7, interactive: false }).addTo(m)
      const line = L.polyline(r.points, { color: r.chosen ? '#116a63' : '#a8b0b7', weight: r.chosen ? 5 : 3.5, opacity: 1 }).addTo(m)
      if (r.onClick) line.on('click', (e) => { L.DomEvent.stop(e); r.onClick?.() })
      if (r.label) line.bindTooltip(r.label, { permanent: true, direction: 'center', className: r.chosen ? 'route-tip route-tip-on' : 'route-tip', opacity: 1, offset: [0, 0] })
      lines.current.push(casing, line)
    }
    const pts: [number, number][] = [
      ...(value ? [[value.lat, value.lng] as [number, number]] : []),
      ...(origin ? [[origin.lat, origin.lng] as [number, number]] : []),
      ...routes.flatMap((r) => r.points),
    ]
    refit.current = () => {
      if (pts.length >= 2) m.fitBounds(L.latLngBounds(pts), { padding: [28, 28], animate: false })
      else if (pts.length === 1) m.setView(pts[0], 14, { animate: false })
    }
    refit.current()
  }, [routes, value, origin, built])

  async function find() {
    if (!q.trim()) return
    setSearching(true); setProblem(null)
    try {
      const hit = await api<GeoPoint & { label: string }>(`/geocode?q=${encodeURIComponent(q.trim())}`)
      onChange({ lat: hit.lat, lng: hit.lng }, hit.label)
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'Couldn’t find that address.')
    } finally {
      setSearching(false)
    }
  }

  return (
    <div className={frame ? 'flex flex-col gap-[8px]' : 'flex h-full flex-col'}>
      {!locked && search && (
        <form onSubmit={(e) => { e.preventDefault(); void find() }} className="flex items-center gap-[6px]">
          <span className="relative flex-1">
            <Search size={14} strokeWidth={2} className="pointer-events-none absolute left-[10px] top-1/2 -translate-y-1/2 text-faint" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={placeholder}
              aria-label="Address to place"
              className="h-[32px] w-full rounded-[6px] border border-inputline bg-white pl-[30px] pr-[10px] font-meta text-[13px] focus:border-teal focus:outline-none"
            />
          </span>
          <button type="submit" disabled={searching || !q.trim()} className="h-[32px] cursor-pointer rounded-[6px] border border-inputline bg-white px-[12px] font-meta text-[12px] font-semibold text-lab hover:bg-fill2 disabled:opacity-50">
            {searching ? 'Finding…' : 'Find'}
          </button>
        </form>
      )}
      {problem && <p className="m-0 font-meta text-[12px] font-semibold text-redtext">{problem}</p>}
      {naming && <p className="m-0 font-meta text-[12px] text-mut">Looking up the address…</p>}
      <div className={`relative overflow-hidden ${frame ? 'rounded-[10px] border border-line' : 'min-h-0 flex-1'}`}>
        <div ref={box} style={{ height }} className="z-0 h-full bg-paper" />
        {!locked && !value && (
          <span className="pointer-events-none absolute left-1/2 top-[10px] z-[500] -translate-x-1/2 rounded-full bg-ink/85 px-[10px] py-[4px] font-meta text-[11.5px] font-medium text-white">
            <Crosshair size={12} strokeWidth={2} className="mr-[5px] inline-block align-[-2px]" />Click the map to drop the pin
          </span>
        )}
      </div>
    </div>
  )
}

const round = (n: number) => Math.round(n * 1e5) / 1e5
