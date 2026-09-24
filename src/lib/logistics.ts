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
  pickup_from_depot: 'Pickup from supplier depot',
  delivery_from_depot: 'Delivery from supplier depot',
}

/**
 * The movements a company truck makes - the ones a trip can be booked as.
 *
 * A delivery from the supplier's depot is the supplier's truck or a hauler,
 * and is recorded on the purchase (its fulfillment), not as a trip. The type
 * stays in MOVEMENT_LABELS so records made before that distinction still
 * open and read correctly.
 */
export const TRIP_MOVEMENTS: readonly MovementType[] = ['delivery_to_client', 'pickup_from_depot', 'pickup_from_client']

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
/**
 * The pre-dispatch checklist, in the order a crew walks it.
 *
 * The vehicle block is BLOWBAGETS - Battery, Lights, Oil, Water, Brakes, Air,
 * Gas, Engine, Tires, Self - the LTO's own pre-trip mnemonic, which the
 * client asked for by name. Then the devices the company fits, the papers and
 * cash the crew carry, and the load. Every box starts empty: a slip that
 * arrives pre-ticked is a slip nobody checked.
 */
export interface ChecklistItem { key: keyof PreDispatchChecklist; label: string; group: ChecklistGroup }
export type ChecklistGroup = 'Vehicle (BLOWBAGETS)' | 'Devices' | 'Documents & cash' | 'Load'

export const CHECKLIST_ITEMS: ReadonlyArray<ChecklistItem> = [
  { key: 'batteryChecked', label: 'Battery', group: 'Vehicle (BLOWBAGETS)' },
  { key: 'lightsChecked', label: 'Lights', group: 'Vehicle (BLOWBAGETS)' },
  { key: 'oilChecked', label: 'Oil', group: 'Vehicle (BLOWBAGETS)' },
  { key: 'waterChecked', label: 'Water', group: 'Vehicle (BLOWBAGETS)' },
  { key: 'brakesChecked', label: 'Brakes', group: 'Vehicle (BLOWBAGETS)' },
  { key: 'airChecked', label: 'Air (tire pressure)', group: 'Vehicle (BLOWBAGETS)' },
  { key: 'fullTankConfirmed', label: 'Gas - truck fuelled', group: 'Vehicle (BLOWBAGETS)' },
  { key: 'engineInspected', label: 'Engine', group: 'Vehicle (BLOWBAGETS)' },
  { key: 'tiresInspected', label: 'Tires', group: 'Vehicle (BLOWBAGETS)' },
  { key: 'driverFit', label: 'Self - driver fit to drive', group: 'Vehicle (BLOWBAGETS)' },
  { key: 'partsInspected', label: 'Parts and body', group: 'Vehicle (BLOWBAGETS)' },
  { key: 'gpsPresent', label: 'GPS present and working', group: 'Devices' },
  { key: 'fuelSensorPresent', label: 'Fuel sensor present and working', group: 'Devices' },
  { key: 'smartLockPresent', label: 'Smart lock present and working', group: 'Devices' },
  { key: 'bodyCamPresent', label: 'Body cam present', group: 'Devices' },
  { key: 'identificationVerified', label: 'Crew identification verified', group: 'Documents & cash' },
  { key: 'driverLicenseChecked', label: 'Driver’s license valid and on board', group: 'Documents & cash' },
  { key: 'receiptOnBoard', label: 'Delivery receipt and/or invoice on board', group: 'Documents & cash' },
  { key: 'tollCardsOnBoard', label: 'Toll cards / RFID loaded', group: 'Documents & cash' },
  { key: 'allowanceHanded', label: 'Allowance handed to crew', group: 'Documents & cash' },
  { key: 'loadConfirmed', label: 'Fuel load matches the orders', group: 'Load' },
]

export const CHECKLIST_GROUPS: readonly ChecklistGroup[] = ['Vehicle (BLOWBAGETS)', 'Devices', 'Documents & cash', 'Load']

/** Who signs the slip on screen. */
export const CHECKLIST_SIGNATORIES = [
  { role: 'driver', label: 'Driver' },
  { role: 'pahinante', label: 'Pahinante' },
  { role: 'dispatcher', label: 'Dispatch personnel' },
] as const

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

/** Every movement carries a checklist except a pickup from a client, where
 * MPower is not sending out a loaded vehicle. */
export const needsChecklist = (d: Delivery) => documentsFor(d).includes('preDispatchChecklist')

export interface ChecklistProgress {
  answered: number
  total: number
  complete: boolean
  outstanding: string[]
  /** All three signatures drawn. */
  signed: boolean
  missingSignatures: string[]
}

export function checklistProgress(c: PreDispatchChecklist | undefined): ChecklistProgress {
  const total = CHECKLIST_ITEMS.length
  const missingSignatures = CHECKLIST_SIGNATORIES.filter((s) => !c?.signatures?.[s.role]?.image).map((s) => s.label)
  if (!c) return { answered: 0, total, complete: false, outstanding: CHECKLIST_ITEMS.map((i) => i.label), signed: false, missingSignatures }
  const outstanding = CHECKLIST_ITEMS.filter((i) => !c[i.key]).map((i) => i.label)
  return { answered: total - outstanding.length, total, complete: outstanding.length === 0, outstanding, signed: missingSignatures.length === 0, missingSignatures }
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

/**
 * When in the day a trip starts, as hours (8.5 = 08:30). The typed time wins;
 * a record with only a date carries whatever hour its timestamp happens to
 * hold, which for a form-entered date is midnight.
 */
/**
 * When the truck actually leaves, as one instant: the schedule day plus the
 * departure time when one is set. The ban checks compare a clock time to a
 * rule's window, and the day's date field alone carries whatever time it was
 * saved with - so a trip moved to 10:00 on the day strip was still checked
 * against the 07:00 the date input left behind.
 */
export function tripDeparture(d: Pick<Delivery, 'scheduleDate' | 'scheduleTime'>): Date {
  const at = new Date(d.scheduleDate)
  if (d.scheduleTime && /^\d{2}:\d{2}/.test(d.scheduleTime)) {
    const [h, m] = d.scheduleTime.split(':').map(Number)
    at.setHours(h, m, 0, 0)
  }
  return at
}

export function tripStartHour(d: Pick<Delivery, 'scheduleDate' | 'scheduleTime'>): number {
  if (d.scheduleTime && /^\d{2}:\d{2}/.test(d.scheduleTime)) {
    const [h, m] = d.scheduleTime.split(':').map(Number)
    return h + m / 60
  }
  const t = new Date(d.scheduleDate)
  return t.getHours() + t.getMinutes() / 60
}

/** How long a truck is taken up by one trip when nobody has said otherwise:
 *  a loading-to-return cycle of about two hours. A trip can carry its own
 *  `durationHours`, set by hand or from a drive-time estimate. */
export const TRIP_BLOCK_HOURS = 2

export const tripHours = (d: Pick<Delivery, 'durationHours'>) =>
  d.durationHours && d.durationHours > 0 ? d.durationHours : TRIP_BLOCK_HOURS

/**
 * Hours a truck needs for a delivery, from a one-way drive time: there,
 * unload, back, plus slack for loading and traffic. Rounded up to the half
 * hour so the board's blocks land on its grid.
 */
export function suggestedHours(minutesOneWay: number, unloadMinutes = 30): number {
  const total = minutesOneWay * 2 + unloadMinutes + 15
  return Math.max(1, Math.ceil((total / 60) * 2) / 2)
}

export const fmtHours = (h: number) => {
  const hh = Math.floor(h)
  const mm = Math.round((h - hh) * 60)
  return hh === 0 ? `${mm}m` : mm === 0 ? `${hh}h` : `${hh}h ${mm}m`
}

export const fmtHour = (h: number) => {
  const hh = Math.floor(h)
  const mm = Math.round((h - hh) * 60)
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

/** The other open trips on this truck that day, earliest first - what
 *  "booked that day" actually means, so a dispatcher can pick a gap. */
export function truckBookings(deliveries: Delivery[], truckId: string, dayISO: string, excludeId?: string) {
  return deliveries
    .filter((d) => d.id !== excludeId && d.truckId === truckId && occupiesOn(d, dayISO))
    .map((d) => ({ delivery: d, start: tripStartHour(d), end: tripStartHour(d) + tripHours(d) }))
    .sort((a, b) => a.start - b.start)
}

/** Does a trip starting at `start` and lasting `hours` overlap any of these bookings? */
export const clashesWith = (start: number, bookings: { start: number; end: number }[], hours = TRIP_BLOCK_HOURS) =>
  bookings.filter((b) => start < b.end && start + hours > b.start)

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
  /**
   * When the truck is out. `time` is when it leaves; `hours` is how long it
   * is on the road after that. Without `hours` only the departure instant is
   * checked - which is the old behaviour, and is wrong for a real trip: a
   * truck leaving at 05:30 on an eight-hour run is on EDSA at 07:00, and
   * the ban catches it there.
   */
  when: { weekday: number; time: string; holiday?: boolean; hours?: number },
  truck?: { heavy?: boolean },
  /** Where the trip's planned route goes; undefined when no route is planned. */
  zones?: readonly string[],
): boolean {
  if (rule.active === false) return false
  // A city's ban only reaches a trip that enters the city. With no route
  // planned there is nothing to check it against, so it stays quiet - the
  // drawer says to plan the route instead.
  if (rule.zone && !(zones ?? []).includes(rule.zone)) return false
  // The trip's span, in minutes from midnight of the day it leaves. A run
  // that ends after midnight also has a slice on the next day, which only
  // counts when the rule is in force on that weekday too.
  const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
  const s = toMin(when.time)
  const e = Math.max(s + 1, s + Math.round((when.hours ?? 0) * 60))
  const spans: [number, number][] = []
  if (rule.weekdays.includes(when.weekday)) spans.push([s, Math.min(e, 1440)])
  if (e > 1440 && rule.weekdays.includes((when.weekday + 1) % 7)) spans.push([0, e - 1440])
  if (spans.length === 0) return false
  // Number coding is lifted on holidays; a truck ban is not - the rule says
  // which it is, so a holiday only clears the rules that the law clears.
  if (rule.suspendedOnHolidays && when.holiday) return false
  // A weight-based ban does not catch a light truck. Unknown weight is heavy
  // (see Truck.gvwKg), which is why the caller passes a boolean, not a number.
  if (rule.appliesTo === 'heavy' && truck?.heavy === false) return false
  // The light-truck ban is the mirror image: an unweighed truck is heavy, so
  // it is not caught by a rule for light ones.
  if (rule.appliesTo === 'light' && truck?.heavy !== false) return false

  const digits = plateNumber.replace(/[^0-9]/g, '')
  const last = digits.slice(-1)
  if (rule.plateEndsWith.length > 0 && !rule.plateEndsWith.includes(last)) return false

  const { startTime: from, endTime: to } = rule
  if (!from || !to) return true
  // The window lifts at its end: a 06:00–10:00 ban is over at 10:00, so a
  // truck back by then is clear - which is what "leave at … instead" in the
  // trip drawer promises. An overnight window is two pieces of the day.
  const f = toMin(from)
  const t = toMin(to)
  const windows: [number, number][] = f <= t ? [[f, t]] : [[f, 1440], [0, t]]
  return spans.some(([a, b]) => windows.some(([wf, wt]) => a < wt && b > wf))
}

/** Every active rule catching a truck at a moment, so a dispatcher can be shown
 * which authority and area to argue with rather than just "banned". */
export function bansFor(
  rules: TruckBanRule[],
  plateNumber: string,
  scheduleISO: string,
  ctx: {
    /** Whether the truck is over the truck-ban weight. Omitted means heavy. */
    heavy?: boolean
    /** Holiday dates as "yyyy-MM-dd", so coding rules can stand down on them. */
    holidays?: readonly string[]
    /** The planned route's zones (TravelEstimate.zones), for city rules. */
    zones?: readonly string[]
    /** How long the truck is out from that moment; omitted checks the moment alone. */
    hours?: number
  } = {},
): TruckBanRule[] {
  const at = new Date(scheduleISO)
  if (Number.isNaN(at.getTime())) return []
  const p2 = (n: number) => String(n).padStart(2, '0')
  const time = `${p2(at.getHours())}:${p2(at.getMinutes())}`
  const day = `${at.getFullYear()}-${p2(at.getMonth() + 1)}-${p2(at.getDate())}`
  const holiday = ctx.holidays?.includes(day) ?? false
  return rules.filter((r) => banApplies(r, plateNumber, { weekday: at.getDay(), time, holiday, hours: ctx.hours }, { heavy: ctx.heavy ?? true }, ctx.zones))
}

/**
 * The rules that catch this truck at any point of that day, with their
 * windows - what the day strip shades red so the dispatcher sees the gap
 * rather than hunting for it. Ordered by start.
 */
export function dayBans(
  rules: TruckBanRule[],
  plateNumber: string,
  scheduleISO: string,
  ctx: Parameters<typeof bansFor>[3] = {},
): TruckBanRule[] {
  const at = new Date(scheduleISO)
  if (Number.isNaN(at.getTime())) return []
  at.setHours(0, 0, 0, 0)
  return bansFor(rules, plateNumber, at.toISOString(), { ...ctx, hours: 24 })
    .filter((r) => r.startTime && r.endTime)
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
}

/**
 * The first departure, on the quarter hour after the current one, at which
 * a run of `hours` is clear of every rule that day - or null when no time
 * that day is. What "Leave at … instead" in the trip drawer offers.
 */
export function clearDeparture(
  rules: TruckBanRule[],
  plateNumber: string,
  scheduleISO: string,
  hours: number,
  ctx: Parameters<typeof bansFor>[3] = {},
): string | null {
  const at = new Date(scheduleISO)
  if (Number.isNaN(at.getTime())) return null
  const p2 = (n: number) => String(n).padStart(2, '0')
  const startMin = at.getHours() * 60 + at.getMinutes()
  for (let m = Math.ceil((startMin + 1) / 15) * 15; m < 1440; m += 15) {
    const t = new Date(at)
    t.setHours(Math.floor(m / 60), m % 60, 0, 0)
    if (bansFor(rules, plateNumber, t.toISOString(), { ...ctx, hours }).length === 0) return `${p2(Math.floor(m / 60))}:${p2(m % 60)}`
  }
  return null
}
