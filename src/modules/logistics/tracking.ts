export interface TruckPosition {
  deliveryId: string
  plateNumber: string
  lat: number
  lng: number
  speedKph: number
  headingDeg: number
  etaMinutes: number
}

export interface TrackingTarget {
  deliveryId: string
  plateNumber: string
  originLat: number
  originLng: number
}

/**
 * Position feed abstraction. The prototype uses SimulatedTrackingProvider;
 * a real telematics integration (Traccar, flespi, Navixy REST) implements
 * the same interface in a later phase.
 */
export interface TrackingProvider {
  subscribe(targets: TrackingTarget[], cb: (positions: TruckPosition[]) => void): () => void
}

/** Waypoint routes along major Luzon corridors (rough highway paths). */
const routes: [number, number][][] = [
  // Valenzuela → Bulacan (NLEX)
  [[14.701, 120.983], [14.735, 120.972], [14.79, 120.955], [14.845, 120.937], [14.873, 120.92]],
  // Valenzuela → Quezon City (Mindanao Ave)
  [[14.701, 120.983], [14.688, 121.005], [14.676, 121.03], [14.655, 121.05], [14.63, 121.06]],
  // Cavite → Bacoor → Dasmariñas (Aguinaldo Hwy)
  [[14.479, 120.897], [14.459, 120.94], [14.43, 120.96], [14.38, 120.94], [14.33, 120.936]],
  // Batangas → Lipa (STAR Tollway)
  [[13.757, 121.058], [13.81, 121.09], [13.87, 121.12], [13.94, 121.15], [13.94, 121.16]],
  // Valenzuela → Subic (NLEX-SCTEX)
  [[14.701, 120.983], [14.84, 120.92], [14.95, 120.78], [14.88, 120.55], [14.82, 120.28]],
]

function interpolate(route: [number, number][], t: number): { lat: number; lng: number; heading: number } {
  const segs = route.length - 1
  const pos = Math.min(t, 0.9999) * segs
  const i = Math.floor(pos)
  const frac = pos - i
  const [lat1, lng1] = route[i]
  const [lat2, lng2] = route[i + 1]
  const lat = lat1 + (lat2 - lat1) * frac
  const lng = lng1 + (lng2 - lng1) * frac
  const heading = (Math.atan2(lng2 - lng1, lat2 - lat1) * 180) / Math.PI
  return { lat, lng, heading }
}

function hash(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

/** Moves trucks along predefined routes on a timer. Deterministic per delivery. */
export class SimulatedTrackingProvider implements TrackingProvider {
  private intervalMs: number
  private tripMinutes: number

  constructor(intervalMs = 2000, tripMinutes = 4) {
    this.intervalMs = intervalMs
    this.tripMinutes = tripMinutes
  }

  subscribe(targets: TrackingTarget[], cb: (positions: TruckPosition[]) => void) {
    const tick = () => {
      const nowMs = Date.now()
      cb(
        targets.map((target) => {
          const h = hash(target.deliveryId)
          const route = routes[h % routes.length]
          const tripMs = this.tripMinutes * 60_000
          const offset = (h % 1000) / 1000
          const t = (((nowMs / tripMs) + offset) % 1)
          const { lat, lng, heading } = interpolate(route, t)
          const wobble = Math.sin(nowMs / 7000 + h) * 6
          return {
            deliveryId: target.deliveryId,
            plateNumber: target.plateNumber,
            lat,
            lng,
            speedKph: Math.round(48 + wobble),
            headingDeg: heading,
            etaMinutes: Math.max(1, Math.round((1 - t) * this.tripMinutes)),
          }
        }),
      )
    }
    tick()
    const id = setInterval(tick, this.intervalMs)
    return () => clearInterval(id)
  }
}
