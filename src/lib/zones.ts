/**
 * Where a route goes, as far as the regulations care.
 *
 * A city truck ban only matters to a trip that enters the city; the Skyway's
 * class limit only to one that takes the Skyway. The route planner hands
 * back the chosen route's line, and this reduces it to the handful of named
 * places the rules are written about. Cities are rough polygons; roads are
 * corridors a couple of hundred metres wide around their centreline. Rough
 * is enough: the question is "does this trip go through Makati", not "which
 * side of Ayala Avenue".
 *
 * Coordinates are hand-traced and approximate. A trip that clips a corner is
 * warned about, which is the right way round for a warning.
 */
export type ZoneKey = 'manila' | 'makatiCbd' | 'paranaque' | 'edsa' | 'shaw' | 'skyway'

export const ZONE_LABELS: Record<ZoneKey, string> = {
  manila: 'City of Manila',
  makatiCbd: 'Makati CBD',
  paranaque: 'Parañaque',
  edsa: 'EDSA',
  shaw: 'Shaw Boulevard',
  skyway: 'Skyway (elevated)',
}

type Pt = [number, number] // [lat, lng]

interface AreaZone { kind: 'area'; polygon: Pt[] }
interface CorridorZone { kind: 'corridor'; line: Pt[]; halfWidthM: number }

const ZONES: Record<ZoneKey, AreaZone | CorridorZone> = {
  manila: {
    kind: 'area',
    polygon: [[14.641, 120.955], [14.641, 121.030], [14.600, 121.032], [14.560, 121.010], [14.556, 120.980], [14.585, 120.960]],
  },
  makatiCbd: {
    kind: 'area',
    polygon: [[14.571, 121.008], [14.571, 121.037], [14.546, 121.037], [14.546, 121.008]],
  },
  paranaque: {
    kind: 'area',
    polygon: [[14.522, 120.975], [14.522, 121.060], [14.440, 121.060], [14.440, 120.975]],
  },
  edsa: {
    kind: 'corridor',
    line: [[14.537, 121.019], [14.553, 121.032], [14.566, 121.045], [14.580, 121.054], [14.590, 121.058], [14.605, 121.056], [14.619, 121.053], [14.638, 121.043], [14.655, 121.030]],
    halfWidthM: 250,
  },
  shaw: {
    kind: 'corridor',
    line: [[14.581, 121.033], [14.585, 121.055], [14.586, 121.075]],
    halfWidthM: 200,
  },
  skyway: {
    kind: 'corridor',
    line: [[14.420, 121.041], [14.460, 121.048], [14.490, 121.050], [14.520, 121.035], [14.545, 121.020], [14.556, 121.015], [14.580, 121.005], [14.600, 121.000], [14.625, 121.003], [14.657, 121.005]],
    halfWidthM: 200,
  },
}

const M_PER_DEG_LAT = 111_320
const mPerDegLng = (lat: number) => M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180)

/** Ray-casting point in polygon, on [lat, lng] pairs. */
function inPolygon([lat, lng]: Pt, poly: Pt[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i]
    const [yj, xj] = poly[j]
    const hit = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
    if (hit) inside = !inside
  }
  return inside
}

/** Metres from a point to the nearest point on a polyline. */
function distToLineM(p: Pt, line: Pt[]): number {
  const kx = mPerDegLng(p[0])
  const ky = M_PER_DEG_LAT
  let best = Infinity
  for (let i = 0; i + 1 < line.length; i++) {
    const [ay, ax] = line[i]
    const [by, bx] = line[i + 1]
    const px = (p[1] - ax) * kx, py = (p[0] - ay) * ky
    const vx = (bx - ax) * kx, vy = (by - ay) * ky
    const len2 = vx * vx + vy * vy
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * vx + py * vy) / len2))
    const dx = px - t * vx, dy = py - t * vy
    best = Math.min(best, Math.sqrt(dx * dx + dy * dy))
  }
  return best
}

function inZone(p: Pt, z: AreaZone | CorridorZone): boolean {
  return z.kind === 'area' ? inPolygon(p, z.polygon) : distToLineM(p, z.line) <= z.halfWidthM
}

/**
 * The zones a route line passes through. Corridors need a few consecutive
 * points inside them, so a road that merely crosses EDSA at right angles is
 * not "on EDSA"; an area counts on a single point.
 */
export function zonesCrossed(line: Pt[]): ZoneKey[] {
  const out: ZoneKey[] = []
  for (const key of Object.keys(ZONES) as ZoneKey[]) {
    const z = ZONES[key]
    if (z.kind === 'area') {
      if (line.some((p) => inZone(p, z))) out.push(key)
      continue
    }
    let run = 0
    let hit = false
    for (const p of line) {
      run = inZone(p, z) ? run + 1 : 0
      if (run >= 3) { hit = true; break }
    }
    if (hit) out.push(key)
  }
  return out
}
