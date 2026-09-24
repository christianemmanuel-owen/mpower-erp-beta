/// <reference types="@cloudflare/workers-types" />
/**
 * Drive-time estimates and geocoding for trip planning.
 *
 *   GET /api/route-estimate?from=<address|lat,lng>&to=<address|lat,lng>
 *     → { provider, from, to, origin, destination, routes: [...], at }
 *       routes: the fastest first, then alternatives, each with minutes, km,
 *       a name for the road it mostly follows, and its line for the map.
 *
 *   GET /api/geocode?q=<address>
 *     → { lat, lng, label } - for placing a typed address on the map picker.
 *
 * Two providers, chosen by what the deployment has:
 *
 *   - Google Routes API when GOOGLE_MAPS_API_KEY is set. Traffic-aware, and
 *     as accurate as Waze on Philippine roads (both are Google's data);
 *     Waze itself has no public routing API. Geocoding goes through the
 *     same key. Billed per request beyond the free tier - one call per
 *     estimate.
 *   - OSRM's public server with Nominatim geocoding otherwise. Free, no key,
 *     no live traffic - a fair-weather figure. Both public services ask for
 *     a User-Agent naming the app and modest volumes, which one click per
 *     trip is.
 *
 * An estimate is a suggestion the dispatcher accepts or changes; it is
 * never applied to a trip on its own.
 */
import { err, json } from './core'

export interface RoutingEnv {
  GOOGLE_MAPS_API_KEY?: string
}

export interface Point { lat: number; lng: number }
export interface RouteOption {
  minutes: number
  km: number
  /** The road it mostly follows - "via SLEX", say. Blank when unknown. */
  summary: string
  /** [lat, lng] pairs, simplified, for drawing. */
  line: [number, number][]
}

const UA = 'MPowerERP/1 (fleet dispatch; contact: office)'

const parsePoint = (s: string): Point | null => {
  const m = s.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/)
  return m ? { lat: Number(m[1]), lng: Number(m[2]) } : null
}

// ---- geocoding ------------------------------------------------------------

async function geocodeGoogle(address: string, key: string): Promise<(Point & { label: string }) | null> {
  const u = new URL('https://maps.googleapis.com/maps/api/geocode/json')
  u.searchParams.set('address', address)
  u.searchParams.set('region', 'ph')
  u.searchParams.set('key', key)
  const r = await fetch(u.toString())
  if (!r.ok) return null
  const body = (await r.json()) as { results?: { geometry: { location: Point }; formatted_address: string }[] }
  const hit = body.results?.[0]
  return hit ? { ...hit.geometry.location, label: hit.formatted_address } : null
}

async function geocodeNominatim(address: string): Promise<(Point & { label: string }) | null> {
  const u = new URL('https://nominatim.openstreetmap.org/search')
  u.searchParams.set('q', address)
  u.searchParams.set('format', 'json')
  u.searchParams.set('limit', '1')
  u.searchParams.set('countrycodes', 'ph')
  const r = await fetch(u.toString(), { headers: { 'User-Agent': UA, Accept: 'application/json' } })
  if (!r.ok) return null
  const body = (await r.json()) as { lat: string; lon: string; display_name: string }[]
  return body[0] ? { lat: Number(body[0].lat), lng: Number(body[0].lon), label: body[0].display_name } : null
}

/**
 * The other direction: a pin's coordinates back to a street address.
 *
 * Dropping a pin used to leave the address field as it was, so a depot placed
 * by clicking the gate sat under the wrong street, or none. Both providers
 * answer this in one call; the label is a suggestion the user can still edit.
 */
async function reverseGoogle(p: Point, key: string): Promise<string | null> {
  const u = new URL('https://maps.googleapis.com/maps/api/geocode/json')
  u.searchParams.set('latlng', `${p.lat},${p.lng}`)
  u.searchParams.set('region', 'ph')
  u.searchParams.set('key', key)
  const r = await fetch(u.toString())
  if (!r.ok) return null
  const body = (await r.json()) as { results?: { formatted_address: string }[] }
  return body.results?.[0]?.formatted_address ?? null
}

async function reverseNominatim(p: Point): Promise<string | null> {
  const u = new URL('https://nominatim.openstreetmap.org/reverse')
  u.searchParams.set('lat', String(p.lat))
  u.searchParams.set('lon', String(p.lng))
  u.searchParams.set('format', 'json')
  u.searchParams.set('zoom', '18')
  const r = await fetch(u.toString(), { headers: { 'User-Agent': UA, Accept: 'application/json' } })
  if (!r.ok) return null
  const body = (await r.json()) as { display_name?: string }
  return body.display_name ?? null
}

export const reverseGeocode = (p: Point, key?: string) => (key ? reverseGoogle(p, key) : reverseNominatim(p))

export async function handleReverseGeocode(url: URL, env: RoutingEnv): Promise<Response> {
  const rawLat = url.searchParams.get('lat')?.trim() ?? ''
  const rawLng = url.searchParams.get('lng')?.trim() ?? ''
  const lat = Number(rawLat)
  const lng = Number(rawLng)
  if (!rawLat || !rawLng || !Number.isFinite(lat) || !Number.isFinite(lng)) return err(400, 'Send `lat` and `lng`.')
  const label = await reverseGeocode({ lat, lng }, env.GOOGLE_MAPS_API_KEY)
  if (!label) return err(422, 'No address is known for that spot.')
  return json({ lat, lng, label })
}

export const geocode = (s: string, key?: string) => {
  const p = parsePoint(s)
  if (p) return Promise.resolve({ ...p, label: s })
  return key ? geocodeGoogle(s, key) : geocodeNominatim(s)
}

// ---- routing --------------------------------------------------------------

/** Google's encoded polyline → [lat, lng] pairs. */
function decodePolyline(str: string): [number, number][] {
  const out: [number, number][] = []
  let index = 0, lat = 0, lng = 0
  while (index < str.length) {
    for (const which of [0, 1]) {
      let shift = 0, result = 0, b: number
      do {
        b = str.charCodeAt(index++) - 63
        result |= (b & 0x1f) << shift
        shift += 5
      } while (b >= 0x20)
      const delta = result & 1 ? ~(result >> 1) : result >> 1
      if (which === 0) lat += delta
      else lng += delta
    }
    out.push([lat / 1e5, lng / 1e5])
  }
  return out
}

/** Keep every nth point so a long route stays a few kilobytes. */
const thin = (line: [number, number][], max = 400) => {
  if (line.length <= max) return line
  const step = Math.ceil(line.length / max)
  return line.filter((_, i) => i % step === 0 || i === line.length - 1)
}

async function routesGoogle(from: Point, to: Point, key: string): Promise<RouteOption[]> {
  const r = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.description,routes.polyline.encodedPolyline',
    },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
      destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE',
      computeAlternativeRoutes: true,
    }),
  })
  if (!r.ok) return []
  const body = (await r.json()) as { routes?: { duration: string; distanceMeters: number; description?: string; polyline?: { encodedPolyline: string } }[] }
  return (body.routes ?? []).map((route) => ({
    minutes: Math.round(parseFloat(route.duration) / 60),
    km: Math.round(route.distanceMeters / 100) / 10,
    summary: route.description ?? '',
    line: thin(route.polyline ? decodePolyline(route.polyline.encodedPolyline) : []),
  }))
}

async function routesOsrm(from: Point, to: Point): Promise<RouteOption[]> {
  const u = `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?alternatives=3&overview=simplified&geometries=geojson`
  const r = await fetch(u, { headers: { 'User-Agent': UA } })
  if (!r.ok) return []
  const body = (await r.json()) as { routes?: { duration: number; distance: number; legs?: { summary?: string }[]; geometry?: { coordinates: [number, number][] } }[] }
  return (body.routes ?? []).map((route) => ({
    minutes: Math.round(route.duration / 60),
    km: Math.round(route.distance / 100) / 10,
    summary: route.legs?.[0]?.summary ? `via ${route.legs[0].summary}` : '',
    line: thin((route.geometry?.coordinates ?? []).map(([lng, lat]) => [lat, lng] as [number, number])),
  }))
}

export async function handleRouteEstimate(url: URL, env: RoutingEnv): Promise<Response> {
  const from = url.searchParams.get('from')?.trim() ?? ''
  const to = url.searchParams.get('to')?.trim() ?? ''
  if (!from || !to) return err(400, 'Send both `from` and `to` - an address, or "lat,lng".')

  const key = env.GOOGLE_MAPS_API_KEY
  const provider = key ? 'google' : 'osrm'
  const [a, b] = await Promise.all([geocode(from, key), geocode(to, key)])
  if (!a) return err(422, `Couldn’t place the origin "${from}" on the map.`)
  if (!b) return err(422, `Couldn’t place "${to}" on the map - try a fuller address with the city, or drop the pin yourself.`)

  const routes = key ? await routesGoogle(a, b, key) : await routesOsrm(a, b)
  if (routes.length === 0) return err(502, 'The routing service didn’t answer. Try again in a moment, or set the time by hand.')
  routes.sort((x, y) => x.minutes - y.minutes)

  return json({
    provider, from, to,
    origin: { lat: a.lat, lng: a.lng, label: a.label },
    destination: { lat: b.lat, lng: b.lng, label: b.label },
    routes,
    at: new Date().toISOString(),
  })
}

export async function handleGeocode(url: URL, env: RoutingEnv): Promise<Response> {
  const q = url.searchParams.get('q')?.trim() ?? ''
  if (!q) return err(400, 'Send `q`, the address to look up.')
  const hit = await geocode(q, env.GOOGLE_MAPS_API_KEY)
  if (!hit) return err(422, `Couldn’t place "${q}" on the map - try a fuller address with the city.`)
  return json(hit)
}
