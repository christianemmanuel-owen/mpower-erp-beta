import type { Truck } from '../data/types'

/**
 * The two rules about the truck itself rather than the clock: how heavy it
 * may be on the road, and which tollways will let it up the ramp.
 *
 * **Overloading (RA 8794 and its IRR, as revised by the DPWH in 2013).** The
 * legal gross weight depends on the axle configuration; the figures below
 * are the revised matrix. Each axle is capped at 13,500 kg besides. Enforced
 * at the tollway entries and DPWH weighbridges, and the fine is a share of
 * the motor vehicle user's charge. Diesel weighs about 0.85 kg a litre, so
 * a truck's load on a trip is its litres times that, on top of its empty
 * weight.
 *
 * **Tollway classes.** Toll operators class vehicles by height and axles:
 * Class 1 cars and light vans, Class 2 buses and closed trucks over seven
 * feet, Class 3 the heavy trucks. The Skyway's elevated sections take
 * Classes 1 and 2 only, so a loaded tanker cannot use Skyway Stage 3 or the
 * elevated stretch south of Buendia, and a route drawn over it has to go
 * at-grade instead.
 *
 * As with the ban schedules, these are facts about the outside world that
 * get revised, so they carry a date.
 */
export const VEHICLE_LIMITS_AS_OF = '2026-09-19'

export const DIESEL_KG_PER_L = 0.85
export const MAX_AXLE_LOAD_KG = 13_500

export type AxleConfig = 'rigid2' | 'rigid3' | 'rigid4' | 'semi5' | 'semi6'

export const AXLE_CONFIGS: { key: AxleConfig; label: string; maxGvwKg: number }[] = [
  { key: 'rigid2', label: '2-axle rigid (6 wheels)', maxGvwKg: 18_000 },
  { key: 'rigid3', label: '3-axle rigid (10 wheels)', maxGvwKg: 33_300 },
  { key: 'rigid4', label: '4-axle rigid (14 wheels)', maxGvwKg: 35_600 },
  { key: 'semi5', label: 'Tractor + semi-trailer, 5 axles (18 wheels)', maxGvwKg: 41_500 },
  { key: 'semi6', label: 'Tractor + semi-trailer, 6 axles (22 wheels)', maxGvwKg: 42_000 },
]

export const axleConfigLabel = (key?: string) => AXLE_CONFIGS.find((a) => a.key === key)?.label ?? 'Axles not set'

/** The legal gross weight for a truck: its own override, else its axle code's. */
export function maxGvwFor(truck: Pick<Truck, 'axleConfig' | 'maxGvwKg'>): number | null {
  if (truck.maxGvwKg) return truck.maxGvwKg
  return AXLE_CONFIGS.find((a) => a.key === truck.axleConfig)?.maxGvwKg ?? null
}

export interface LoadCheck {
  /** Empty weight plus the fuel, kg. */
  ladenKg: number
  maxKg: number
  overKg: number
}

/**
 * Whether a trip's litres put the truck over its legal weight. Null when the
 * truck's empty weight or axle code is not on file - there is nothing to
 * check against, and the caller says so instead of guessing.
 */
export function loadCheck(truck: Pick<Truck, 'tareKg' | 'axleConfig' | 'maxGvwKg'>, liters: number | undefined): LoadCheck | null {
  const maxKg = maxGvwFor(truck)
  if (!truck.tareKg || !maxKg || liters === undefined) return null
  const ladenKg = Math.round(truck.tareKg + liters * DIESEL_KG_PER_L)
  return { ladenKg, maxKg, overKg: Math.max(0, ladenKg - maxKg) }
}

export type TollClass = 1 | 2 | 3

export const TOLL_CLASSES: { key: TollClass; label: string }[] = [
  { key: 1, label: 'Class 1 - cars, light vans' },
  { key: 2, label: 'Class 2 - buses, closed trucks over 7 ft' },
  { key: 3, label: 'Class 3 - heavy trucks' },
]

/** Which toll class a truck is, defaulting a heavy or unknown truck to 3. */
export const tollClassFor = (truck: Pick<Truck, 'tollClass' | 'gvwKg'>): TollClass =>
  truck.tollClass ?? (truck.gvwKg !== undefined && truck.gvwKg !== null && truck.gvwKg <= 4500 ? 2 : 3)

/** Roads (as zone keys) closed to a toll class. */
export const TOLL_CLASS_LIMITS: { zone: 'skyway'; barred: TollClass[]; label: string; source: string }[] = [
  { zone: 'skyway', barred: [3], label: 'Skyway elevated sections and Stage 3 take Class 1 and 2 only', source: 'Toll Regulatory Board / Skyway O&M advisories, 2021–2022' },
]

/** The tollway limits a route breaks for this truck, if any. */
export function tollProblems(truck: Pick<Truck, 'tollClass' | 'gvwKg'>, zones: readonly string[] | undefined): typeof TOLL_CLASS_LIMITS {
  if (!zones) return []
  const cls = tollClassFor(truck)
  return TOLL_CLASS_LIMITS.filter((l) => zones.includes(l.zone) && l.barred.includes(cls))
}
