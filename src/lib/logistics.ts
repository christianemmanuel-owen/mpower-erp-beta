import { MOVEMENT_DOCUMENTS } from '../data/types'
import type {
  Delivery, DeliveryStatus, MaintenanceStatus, MovementType, Personnel,
  PreDispatchChecklist, Truck, TruckBanRule, VehicleMaintenance,
} from '../data/types'

/**
 * Logistics selectors - Exhibit A 1.5.
 *
 * Two things here are worth reading before changing anything.
 *
 * **On time is measured against the final schedule, not the request.** Exhibit A
 * 1.5 distinguishes the customer's requested schedule from "a reorganised final
 * schedule" that Logistics sets. Performance is MPower's promise-keeping, so it
 * compares completion against the schedule MPower committed to. Measuring
 * against the customer's original request would score Logistics down every time
 * it negotiated a different slot and hit it perfectly. `requestedDate` is kept
 * on the record so the gap between what was asked for and what was agreed stays
 * visible - see `scheduleDrift()`.
 *
 * **Completed and on-time are different denominators.** A movement that never
 * happened is not "late", it is not completed, and folding the two together
 * hides the difference between a fleet that runs late and a fleet that fails.
 */

export const DEFAULT_MOVEMENT: MovementType = 'delivery_to_client'

export const movementType = (d: Delivery): MovementType => d.movementType ?? DEFAULT_MOVEMENT

export const MOVEMENT_LABELS: Record<MovementType, string> = {
  delivery_to_client: 'Delivery to client',
  pickup_from_client: 'Pickup from client',
  pickup_from_depot: 'Pickup from depot',
  delivery_from_depot: 'Delivery from depot',
}

/** Terminal states - a movement here will not change again on its own. */
export const isConcluded = (s: DeliveryStatus) => s === 'delivered' || s === 'failed'

/** The document slots this movement needs, per Exhibit A 1.5. */
export const documentsFor = (d: Delivery): readonly string[] => MOVEMENT_DOCUMENTS[movementType(d)]

/**
 * Every checklist question Exhibit A 1.5 lists, in the order it lists them.
 *
 * These are manual entries. The spec is explicit: "For clarity, these are manual
 * checklist entries. The System does not read device status directly." So the
 * GPS, fuel-sensor and smart-lock rows are an operator confirming they looked -
 * they are not device reads, and must not quietly become device reads when 2.8
 * and 2.9 land. A live feed would go in a separate field beside these.
 */
export const CHECKLIST_ITEMS: ReadonlyArray<{ key: keyof PreDispatchChecklist; label: string }> = [
  { key: 'identificationVerified', label: 'Identification verified' },
  { key: 'loadConfirmed', label: 'Load confirmed' },
  { key: 'gpsPresent', label: 'GPS present and functioning' },
  { key: 'fuelSensorPresent', label: 'Fuel sensor present and functioning' },
  { key: 'smartLockPresent', label: 'Smart lock present and functioning' },
  { key: 'fullTankConfirmed', label: 'Full tank confirmed' },
  { key: 'engineInspected', label: 'Engine inspected' },
  { key: 'partsInspected', label: 'Parts inspected' },
  { key: 'tiresInspected', label: 'Tires inspected' },
  { key: 'bodyCamPresent', label: 'Body cam present' },
]

export const emptyChecklist = (): PreDispatchChecklist => ({
  identificationVerified: false,
  loadConfirmed: false,
  gpsPresent: false,
  fuelSensorPresent: false,
  smartLockPresent: false,
  fullTankConfirmed: false,
  engineInspected: false,
  partsInspected: false,
  tiresInspected: false,
  bodyCamPresent: false,
})

/** A pickup from a client is the one movement MPower does not dispatch a loaded
 * vehicle for, so it carries no pre-dispatch checklist (Exhibit A 1.5). */
export const needsChecklist = (d: Delivery) => documentsFor(d).includes('preDispatchChecklist')

export interface ChecklistProgress {
  answered: number
  total: number
  complete: boolean
  /** Items still unticked, so the dispatcher is told what is outstanding rather
   * than just that something is. */
  outstanding: string[]
}

export function checklistProgress(c: PreDispatchChecklist | undefined): ChecklistProgress {
  const total = CHECKLIST_ITEMS.length
  if (!c) return { answered: 0, total, complete: false, outstanding: CHECKLIST_ITEMS.map((i) => i.label) }
  const outstanding = CHECKLIST_ITEMS.filter((i) => !c[i.key]).map((i) => i.label)
  return { answered: total - outstanding.length, total, complete: outstanding.length === 0, outstanding }
}

const DAY = 86_400_000

/** Start-of-day in the runtime's timezone, so "on time" means the agreed day
 * rather than the agreed millisecond. A delivery booked for the 5th and
 * completed at 6pm on the 5th is on time. */
const dayStart = (iso: string) => {
  const d = new Date(iso)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * Was this movement completed on or before the day it was finally scheduled for?
 * Null when it can't be judged: not concluded, or completed with no timestamp.
 */
export function wasOnTime(d: Delivery): boolean | null {
  if (d.status !== 'delivered') return null
  const completedAt = d.outcome?.completedAt
  if (!completedAt) return null
  return dayStart(completedAt) <= dayStart(d.scheduleDate)
}

/** Days between the customer's request and the schedule Logistics settled on.
 * Positive means later than asked. Null when no request was recorded. */
export function scheduleDrift(d: Delivery): number | null {
  if (!d.requestedDate) return null
  return Math.round((dayStart(d.scheduleDate) - dayStart(d.requestedDate)) / DAY)
}

export interface DeliveryPerformance {
  /** Movements that reached a terminal state in the window. */
  concluded: number
  delivered: number
  failed: number
  /** Of the delivered ones, how many could be judged for timeliness. */
  judged: number
  onTime: number
  late: number
  /** delivered / concluded. Null when nothing concluded. */
  completionRate: number | null
  /** onTime / judged. Null when nothing could be judged. */
  onTimeRate: number | null
  /** Still open past their scheduled day. */
  overdueOpen: number
}

/**
 * Percentage on time and percentage completed (Exhibit A 1.5).
 *
 * `judged` exists because a delivered movement with no completion timestamp
 * cannot honestly be called early or late. Counting it as on time would flatter
 * the number; counting it as late would punish record-keeping rather than
 * performance. It is excluded from the ratio and reported separately, so the
 * gap between `delivered` and `judged` shows how much of the fleet's timeliness
 * is actually being recorded.
 */
export function deliveryPerformance(deliveries: Delivery[], now = Date.now()): DeliveryPerformance {
  const concluded = deliveries.filter((d) => isConcluded(d.status))
  const delivered = concluded.filter((d) => d.status === 'delivered')
  const verdicts = delivered.map(wasOnTime).filter((v): v is boolean => v !== null)
  const onTime = verdicts.filter(Boolean).length

  const overdueOpen = deliveries.filter(
    (d) => !isConcluded(d.status) && dayStart(d.scheduleDate) < dayStart(new Date(now).toISOString()),
  ).length

  return {
    concluded: concluded.length,
    delivered: delivered.length,
    failed: concluded.filter((d) => d.status === 'failed').length,
    judged: verdicts.length,
    onTime,
    late: verdicts.length - onTime,
    completionRate: concluded.length > 0 ? delivered.length / concluded.length : null,
    onTimeRate: verdicts.length > 0 ? onTime / verdicts.length : null,
    overdueOpen,
  }
}

// ---- Resource availability (Exhibit A 1.5) ---------------------------------

/** Does this movement occupy its crew and vehicle on the given day? A concluded
 * movement does not - the truck is back. */
const occupiesOn = (d: Delivery, dayISO: string) =>
  !isConcluded(d.status) && d.scheduleDate.slice(0, 10) === dayISO

export interface Availability<T> {
  free: T[]
  busy: Array<{ item: T; deliveryId: string }>
}

/**
 * Who and what is free on a given day.
 *
 * Deliberately day-granular. The System records a schedule date and an optional
 * requested time, not a duration, so it cannot know whether two trips on the
 * same day actually clash. Treating a person as busy for the whole day is the
 * conservative reading: it may under-report availability, which shows up as a
 * dispatcher overriding it, rather than over-reporting it, which shows up as a
 * driver double-booked on the road.
 */
export function availableOn<T extends { id: string }>(
  pool: T[],
  deliveries: Delivery[],
  dayISO: string,
  assignedIds: (d: Delivery) => Array<string | undefined>,
): Availability<T> {
  const busyBy = new Map<string, string>()
  for (const d of deliveries) {
    if (!occupiesOn(d, dayISO)) continue
    for (const id of assignedIds(d)) if (id) busyBy.set(id, d.id)
  }
  const free = pool.filter((x) => !busyBy.has(x.id))
  const busy = pool
    .filter((x) => busyBy.has(x.id))
    .map((item) => ({ item, deliveryId: busyBy.get(item.id) as string }))
  return { free, busy }
}

export const availableTrucks = (trucks: Truck[], deliveries: Delivery[], dayISO: string) =>
  availableOn(trucks, deliveries, dayISO, (d) => [d.truckId])

export const availableCrew = (
  personnel: Personnel[],
  deliveries: Delivery[],
  dayISO: string,
  role: Personnel['role'],
) =>
  availableOn(
    personnel.filter((p) => p.role === role && p.active !== false),
    deliveries,
    dayISO,
    (d) => [d.driverId, d.pahinanteId, d.loaderId, d.guardId],
  )

// ---- Vehicle maintenance (Exhibit A 1.5) ------------------------------------

/** Statuses that actually take a truck off the road. A cancelled job never
 * happened, and a finished one has given the truck back. */
const BLOCKS_TRUCK = new Set<MaintenanceStatus>(['scheduled', 'in_progress'])

/** Does this job occupy its truck on the given day? A job with no end date is a
 * single day; one with an end date runs inclusive of both ends. */
export function maintenanceCovers(m: VehicleMaintenance, dayISO: string): boolean {
  if (!BLOCKS_TRUCK.has(m.status)) return false
  const from = m.scheduledDate.slice(0, 10)
  const to = (m.endDate ?? m.scheduledDate).slice(0, 10)
  return dayISO >= from && dayISO <= to
}

/**
 * Trucks off the road for maintenance on a day.
 *
 * `availableTrucks` has always answered "no movement booked", which was only
 * ever half the question: a truck in the workshop is not available either, and
 * the maintenance table it should have been reading had no UI and no rows. This
 * is the other half, kept separate so a caller can still ask each question on
 * its own.
 */
export function trucksInMaintenance(maintenance: VehicleMaintenance[], dayISO: string): Set<string> {
  return new Set(maintenance.filter((m) => maintenanceCovers(m, dayISO)).map((m) => m.truckId))
}

/** Days until a scheduled job comes due; negative once it is past. */
export function daysUntil(dateISO: string, todayISO: string): number {
  return Math.round((Date.parse(dateISO.slice(0, 10)) - Date.parse(todayISO)) / 86_400_000)
}

// ---- Truck ban and colour coding (Exhibit A 1.5) -----------------------------

/**
 * Does a ban rule catch this plate at this moment?
 *
 * Three parts, and each one is a way to get this wrong.
 *
 * **The plate.** `plateEndsWith` empty means a blanket ban on every truck, not
 * a ban on nothing - number coding restricts some plates, a truck ban restricts
 * all of them, and the same table carries both.
 *
 * **The day.** Weekdays are stored 0 (Sun) to 6 (Sat) to match `getDay()`.
 *
 * **The window.** Compared as "HH:mm" strings, which sorts correctly for
 * zero-padded 24-hour times. A window that wraps past midnight (22:00 to 05:00)
 * is treated as two pieces rather than an empty range, because the naive
 * comparison would silently match nothing and a dispatcher would be told a
 * night ban does not apply.
 */
export function banApplies(
  rule: TruckBanRule,
  plateNumber: string,
  when: { weekday: number; time: string },
): boolean {
  if (rule.active === false) return false
  if (!rule.weekdays.includes(when.weekday)) return false

  const digits = plateNumber.replace(/[^0-9]/g, '')
  const last = digits.slice(-1)
  if (rule.plateEndsWith.length > 0 && !rule.plateEndsWith.includes(last)) return false

  const { startTime: from, endTime: to } = rule
  if (!from || !to) return true
  return from <= to
    ? when.time >= from && when.time <= to
    : when.time >= from || when.time <= to
}

/** Every active rule catching a truck at a moment, so a dispatcher can be shown
 * which authority and area to argue with rather than just "banned". */
export function bansFor(
  rules: TruckBanRule[],
  plateNumber: string,
  scheduleISO: string,
): TruckBanRule[] {
  const at = new Date(scheduleISO)
  if (Number.isNaN(at.getTime())) return []
  const time = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
  return rules.filter((r) => banApplies(r, plateNumber, { weekday: at.getDay(), time }))
}
