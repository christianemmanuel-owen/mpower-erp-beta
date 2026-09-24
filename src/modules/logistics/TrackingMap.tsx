import { useEffect, useMemo, useRef, useState } from 'react'
import { RecordLink } from '../../lib/peek'
import L from 'leaflet'
import { recordHref } from '../../lib/deepLink'
import type { TrackingTarget, TruckPosition } from './tracking'
import { SimulatedTrackingProvider } from './tracking'
import { LUZON_LAND } from './luzon'

const provider = new SimulatedTrackingProvider()

/**
 * Live positions, as a map paired with the list of what is on it.
 *
 * The old map put a full label on every truck - plate, speed and ETA, all the
 * time. Two trucks on the same corridor overlapped into an unreadable stack,
 * and there was nothing to click: a moving truck could not take you to its
 * trip. It was a picture of the fleet rather than a way into it.
 *
 * Markers are quiet now and the detail lives beside the map, the way an
 * operations map usually splits it. One truck is selected at a time; that one
 * gets its plate, and only that one. Selecting from either side selects on the
 * other.
 *
 * The feed has always sent `headingDeg` and nothing ever drew it, so a truck
 * pointed the same way whichever direction it was travelling. The marker is an
 * arrow now and it points where the truck is going.
 */

export interface TripLabel {
  customer: string
  address: string
  driver: string
}

/** The panel is wide and short, so fitBounds sizes the frame off the latitude
 * span and then fills the width with whatever is either side - which around
 * Manila is a great deal of sea. Capping the zoom keeps a single truck from
 * being framed at street level; the padding keeps markers off the edges. */
const FIT: L.FitBoundsOptions = { maxZoom: 11, padding: [28, 28] }

const TEAL = '#116a63'
const INK = '#1f242a'
const LINE = '#e5e8ea'

function truckIcon(p: TruckPosition, selected: boolean) {
  const size = selected ? 30 : 22
  const body = `
    <span style="
      display:flex;align-items:center;justify-content:center;
      width:${size}px;height:${size}px;border-radius:9999px;
      background:${selected ? TEAL : '#fff'};
      border:${selected ? '2px' : '1.5px'} solid ${selected ? TEAL : INK};
      box-shadow:0 1px 4px rgba(20,24,27,.28);
      transform:rotate(${p.headingDeg}deg);
    ">
      <svg width="${selected ? 13 : 10}" height="${selected ? 13 : 10}" viewBox="0 0 10 10" aria-hidden="true">
        <path d="M5 0.5 L9 9 L5 6.9 L1 9 Z" fill="${selected ? '#fff' : INK}"/>
      </svg>
    </span>`

  // Only the selected truck carries its plate. Every marker labelled at once is
  // what made two trucks on one corridor unreadable.
  const plate = selected
    ? `<span style="
         margin-top:3px;background:#fff;border:1px solid ${LINE};border-radius:6px;
         padding:1px 6px;font-family:'IBM Plex Sans',sans-serif;font-size:11px;
         font-weight:600;white-space:nowrap;color:${INK};
         box-shadow:0 1px 3px rgba(20,24,27,.16)">${p.plateNumber}</span>`
    : ''

  return L.divIcon({
    className: '',
    html: `<span style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-50%)">${body}${plate}</span>`,
  })
}

function depotIcon(name: string) {
  return L.divIcon({
    className: '',
    // Depots are the fixed background of the picture, not the live thing on it.
    // A chip rather than bare text: an unbacked label sitting on map detail is
    // unreadable wherever the map is busy, which is exactly where the depots are.
    // Mark on the point, name underneath it. Side by side, a truck sitting at
    // a depot covered the first letters of its name - which is exactly where
    // trucks are most of the time.
    html: `<span style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-50%)">
      <span style="width:7px;height:7px;border-radius:2px;background:#a8b0b7;border:1px solid #fff"></span>
      <span style="margin-top:3px;background:rgba(255,255,255,.9);border-radius:4px;padding:0 4px;
        font-family:'IBM Plex Sans',sans-serif;font-size:11px;color:#5f6971;white-space:nowrap">${name.replace(' depot', '')}</span>
    </span>`,
  })
}

export default function TrackingMap({ targets, depots, labels, height = 380 }: {
  targets: TrackingTarget[]
  depots: { name: string; lat: number; lng: number }[]
  labels: Record<string, TripLabel>
  /** Map height in px. Taller when the map is the whole page. */
  height?: number
}) {
  const mapRef = useRef<L.Map | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const markersRef = useRef(new Map<string, L.Marker>())
  /** The fleet the view was last framed for. A one-shot flag meant that
   * whichever fit happened to run first won for the life of the map, and on
   * this data that was the depots - which is why two trucks ten kilometres
   * apart were being shown on a frame two hundred kilometres tall. */
  const fittedFor = useRef('')
  const [positions, setPositions] = useState<TruckPosition[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  /**
   * Which basemap. Simple is the default because the subject of this map is
   * five trucks, and the street style spends most of its ink on things that
   * are not them. Streets stays available because "where is it" and "what road
   * is it on" are different questions and a dispatcher asks both.
   */
  const [basemap, setBasemap] = useState<'streets' | 'simple'>('streets')

  /**
   * Depots keyed by value, not by array identity.
   *
   * The effect below builds the map once and tears it down when its dependency
   * changes. `depots` is rebuilt by the caller on every data refetch, so with
   * the array itself as the dependency the whole map was destroyed and
   * recreated on a poll - losing the pan, the zoom and every truck marker,
   * several times a minute, for a set of depots that had not moved.
   */
  const depotKey = depots.map((d) => `${d.name}:${d.lat}:${d.lng}`).join('|')

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const markers = markersRef.current
    // Capped well below street level. Nobody dispatching a tanker needs to see
    // building outlines, and the detail that appears past z14 is all clutter at
    // this job's scale.
    const map = L.map(containerRef.current, { zoomControl: true, attributionControl: true, maxZoom: 14 })
    for (const depot of depots) {
      L.marker([depot.lat, depot.lng], { icon: depotIcon(depot.name), interactive: false, zIndexOffset: -1000 }).addTo(map)
    }
    // A hardcoded centre and zoom pointed at Cavite whatever the data said. Fit
    // to the depots first so the map is never blank, then to the trucks once
    // the feed reports where they are.
    if (depots.length > 0) {
      map.fitBounds(L.latLngBounds(depots.map((d) => [d.lat, d.lng] as [number, number])), FIT)
    } else {
      map.setView([14.35, 120.95], 9)
    }
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
      markers.clear()
      fittedFor.current = ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depotKey])

  /**
   * The basemap layer, rebuilt on switch but never rebuilding the map.
   *
   * Simple draws the coastline itself: land filled on a pale water ground, no
   * roads, no labels, and above all no maritime boundaries or ferry routes -
   * the lines the raster tiles paint across open water, which cannot be
   * filtered out because they are part of the image.
   *
   * Streets is the OSM raster, faded and desaturated as before.
   */
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const layer = basemap === 'streets'
      ? // Raster OpenStreetMap, faded and desaturated in CSS.
        //
        // A vector style would look better - real road hierarchy, sparse
        // labels, no maritime boundaries drawn across open water. Every hosted
        // one is either keyed, licence-ambiguous, or a service that can be
        // unreachable; two were tried and both shipped blank. These tiles are
        // the ones that demonstrably render in the browsers this runs in, and a
        // street map that appears beats a nicer one that might not.
        //
        // The route to the better map, and what was ruled out on the way, is
        // written up in docs/SELF_HOSTED_MAP_TILES.md.
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          detectRetina: true,
          opacity: 0.62,
          attribution: '© OpenStreetMap contributors',
        })
      : L.geoJSON(LUZON_LAND as never, {
          style: {
            color: '#d3d8dc',   // coastline
            weight: 1,
            fillColor: '#fbfcfc', // land
            fillOpacity: 1,
            interactive: false,
          },
          attribution: 'Coastline: Natural Earth',
        })

    layer.addTo(map)

    // A style that will not load leaves a blank canvas with trucks floating on
    // it, which is a worse map than the plain one. Drop to the coastline
    // instead - once, not on every failed tile.
    const credit = basemap === 'streets'
      ? '© OpenStreetMap contributors © OpenFreeMap'
      : 'Coastline: Natural Earth'
    map.attributionControl?.addAttribution(credit)
    const container = map.getContainer()
    // Water is the ground the land sits on, so it is the container's own
    // background rather than another drawn shape. The vector style paints its
    // own water, so it needs neither this nor the desaturation filter that the
    // raster tiles did.
    container.style.background = basemap === 'simple' ? '#e4ecf0' : ''
    // Only the raster tiles need correcting; the drawn map picks its own colours.
    container.classList.toggle('map-quiet', basemap === 'streets')
    return () => {
      map.removeLayer(layer)
      map.attributionControl?.removeAttribution(credit)
    }
  }, [basemap])

  useEffect(() => {
    if (targets.length === 0) {
      setPositions([])
      return
    }
    return provider.subscribe(targets, (next) => setPositions(next))
  }, [targets])

  // Markers follow the positions; selection only changes how they are drawn.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    for (const p of positions) {
      const icon = truckIcon(p, p.deliveryId === selected)
      const existing = markersRef.current.get(p.deliveryId)
      if (existing) {
        existing.setLatLng([p.lat, p.lng])
        existing.setIcon(icon)
        existing.setZIndexOffset(p.deliveryId === selected ? 1000 : 0)
      } else {
        const marker = L.marker([p.lat, p.lng], { icon, zIndexOffset: 0 })
          .addTo(map)
          .on('click', () => setSelected(p.deliveryId))
        markersRef.current.set(p.deliveryId, marker)
      }
    }
    for (const [id, marker] of markersRef.current) {
      if (!positions.some((p) => p.deliveryId === id)) {
        marker.remove()
        markersRef.current.delete(id)
      }
    }

    // Trucks only. Including every depot stretched the frame to whichever one
    // was furthest away and pushed the trucks into a corner - on this fleet,
    // Batangas dragged a Bulacan convoy down to a view of half of Luzon.
    //
    // Refit when the set of tracked trucks changes, not once for the life of
    // the map: one dispatched an hour into the shift should be framed too.
    // Positions themselves are deliberately not a trigger, or the view would
    // chase the trucks and never sit still.
    const fleet = positions.map((p) => p.deliveryId).sort().join(',')
    if (fleet && fleet !== fittedFor.current) {
      fittedFor.current = fleet
      const bounds = L.latLngBounds(positions.map((p) => [p.lat, p.lng] as [number, number]))
      // Trucks on the same corridor make a bounds of almost no area, which
      // fitBounds answers by zooming to the cap. Give it a floor so the frame
      // keeps enough ground around them to be worth looking at.
      map.fitBounds(bounds.pad(0.6), FIT)
    }
  }, [positions, selected, depots])

  const rows = useMemo(
    () => [...positions].sort((a, b) => a.etaMinutes - b.etaMinutes),
    [positions],
  )

  function focus(id: string) {
    setSelected(id)
    const p = positions.find((x) => x.deliveryId === id)
    if (p) mapRef.current?.panTo([p.lat, p.lng])
  }

  return (
    <div className="flex overflow-hidden rounded-[8px] border border-line">
      <div ref={containerRef} className="relative z-0 flex-1 bg-paper" style={{ height }} />
      <div className="flex w-[268px] shrink-0 flex-col border-l border-line bg-white">
        <div className="flex items-center gap-2 border-b border-linesoft px-[14px] py-[10px]">
          <span className="text-[13px] font-semibold">On the road</span>
          <span className="ml-auto font-meta text-[12px] text-mut">{rows.length}</span>
        </div>
        <div className="flex gap-[2px] border-b border-linesoft px-[14px] py-[8px]">
          {(['simple', 'streets'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setBasemap(mode)}
              aria-pressed={basemap === mode}
              className={`flex-1 cursor-pointer rounded-[6px] border-0 px-[9px] py-[4px] font-meta text-[12px] capitalize transition-colors ${
                basemap === mode ? 'bg-fill2 font-semibold text-ink' : 'bg-transparent text-mut hover:text-ink'
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto">
          {rows.length === 0 && (
            <p className="m-0 px-[14px] py-6 text-center font-meta text-[12px] text-faint">
              Waiting for the first position report.
            </p>
          )}
          {rows.map((p) => {
            const label = labels[p.deliveryId]
            const on = p.deliveryId === selected
            const href = recordHref('deliveries', p.deliveryId)
            return (
              <button
                key={p.deliveryId}
                type="button"
                onClick={() => focus(p.deliveryId)}
                aria-pressed={on}
                className={`block w-full cursor-pointer border-0 border-b border-linesoft px-[14px] py-[9px] text-left transition-colors last:border-0 ${
                  on ? 'bg-fill2' : 'bg-transparent hover:bg-paper'
                }`}
              >
                <span className="flex items-baseline gap-2">
                  <span className="text-[13px] font-semibold">{p.plateNumber}</span>
                  <span className="tnum ml-auto font-meta text-[12px] font-semibold text-tealtext">
                    ETA {p.etaMinutes}m
                  </span>
                </span>
                <span className="mt-[1px] block truncate font-meta text-[12px] text-mut">
                  {label?.customer ?? 'No customer recorded'}
                </span>
                {on && (
                  <span className="mt-[6px] block font-meta text-[12px] text-mut">
                    <span className="tnum">{p.speedKph} km/h</span>
                    {label?.driver ? ` · ${label.driver}` : ''}
                    {label?.address && <span className="mt-[2px] block truncate text-faint">{label.address}</span>}
                    {href && (
                      <RecordLink
                        to={href}
                        onClick={(e) => e.stopPropagation()}
                        className="mt-[6px] inline-block font-semibold text-teal hover:underline"
                      >
                        Open trip
                      </RecordLink>
                    )}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
