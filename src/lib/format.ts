const peso = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 2 })
const num = new Intl.NumberFormat('en-PH', { maximumFractionDigits: 0 })

export function fmtCurrency(v: number) {
  return peso.format(v)
}

/** "₱1.18M", "₱312k" - for a cell that must never wrap. Exact below ₱10,000. */
export function fmtCurrencyShort(v: number) {
  const abs = Math.abs(v)
  if (abs >= 1_000_000) return `₱${(v / 1_000_000).toFixed(2).replace(/\.?0+$/, '')}M`
  if (abs >= 10_000) return `₱${Math.round(v / 1000)}k`
  return peso.format(v).replace('.00', '')
}

/** "9 Sep" - the short date a phone row can afford. */
export function fmtDayMonth(iso: string) {
  return new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })
}

export function fmtLiters(v: number) {
  return `${num.format(v)} L`
}

export function fmtNum(v: number) {
  return num.format(v)
}

/** ₱14.68M / ₱742k style compact peso. */
export function fmtCompactPeso(v: number) {
  if (Math.abs(v) >= 1_000_000) return `₱${(v / 1_000_000).toFixed(2)}M`
  if (Math.abs(v) >= 1_000) return `₱${Math.round(v / 1_000).toLocaleString()}k`
  return peso.format(v)
}

/** 1.2M L / 300k L style compact liters - for chart axis ticks, where "300,000 L" wraps. */
export function fmtCompactLiters(v: number) {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M L`
  if (Math.abs(v) >= 1_000) return `${Math.round(v / 1_000)}k L`
  return `${Math.round(v)} L`
}

export function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: false })
}

/** A stamp: the day and the time, for "who did this and when". Dropping the
 *  year keeps it to one line - a stamp is read next to its record, which
 *  carries the date in full. */
export function fmtDateTime(iso: string) {
  return `${new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}, ${fmtTime(iso)}`
}

export function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Today as plain "yyyy-MM-dd" in the viewer's OWN calendar, not UTC.
 *
 * `todayISO()` is the obvious spelling and it is wrong
 * east of Greenwich: in Manila (UTC+8) it returns YESTERDAY every day between
 * midnight and 08:00. A dispatcher opening the attendance grid at 06:30 would be
 * encoding onto the previous day, and payroll would suggest the cutoff before the
 * one just finished. Same family as the addDaysISO note below. */
export function todayISO(now = new Date()): string {
  const p2 = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}`
}

/** The calendar day an ISO timestamp falls on, in the viewer's own timezone,
 * as plain "yyyy-MM-dd" - the same space as todayISO(). Slicing the ISO string
 * instead reads the UTC day, which in Manila is yesterday until 08:00 and the
 * comparison "due before today" is off by one for a third of every day. */
export function dayISO(iso: string): string {
  return todayISO(new Date(iso))
}

/** date + days, both in and out as plain "yyyy-MM-dd" - for auto-filling a due date from a
 * transaction date and an account's standing payment term. Does all arithmetic in UTC calendar
 * space (not the runtime's local timezone): parsing "yyyy-MM-ddT00:00:00" as local time and then
 * reading back via toISOString (UTC) shifts the result a day off whenever the local offset is
 * positive - e.g. Asia/Manila (UTC+8) turns local midnight into the previous UTC day. */
export function addDaysISO(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number)
  const utc = new Date(Date.UTC(y, m - 1, d))
  utc.setUTCDate(utc.getUTCDate() + days)
  return utc.toISOString().slice(0, 10)
}

/** "Net 30" / "COD" style label for a payment term. */
export function fmtTerm(days: number) {
  return days <= 0 ? 'COD' : `Net ${days}`
}

export const labels: Record<string, string> = {
  // Truck axle codes and tollway classes (lib/vehicleLimits.ts).
  rigid2: '2-axle rigid (6 wheels)',
  rigid3: '3-axle rigid (10 wheels)',
  rigid4: '4-axle rigid (14 wheels)',
  semi5: 'Tractor + semi-trailer, 5 axles (18 wheels)',
  semi6: 'Tractor + semi-trailer, 6 axles (22 wheels)',
  '1': 'Class 1 - cars, light vans',
  '2': 'Class 2 - buses, closed trucks over 7 ft',
  '3': 'Class 3 - heavy trucks',
  pickup: 'Pick up',
  delivered: 'Delivered',
  delivery: 'Delivery',
  cash: 'Cash',
  check: 'Check',
  bank_transfer: 'Bank transfer',
  pending: 'Pending',
  collected: 'Collected',
  // The custody chain past the collector. "Collected" stays the collector's
  // word; these two are Treasury's.
  deposited: 'In clearing',
  cleared: 'Cleared',
  paid: 'Paid',
  cancelled: 'Cancelled',
  overdue: 'Overdue',
  draft: 'Draft',
  confirmed: 'Confirmed',
  fulfilled: 'Fulfilled',
  ordered: 'Ordered',
  received: 'Received',
  scheduled: 'Scheduled',
  loading: 'Loading',
  in_transit: 'In transit',
  failed: 'Failed',
  driver: 'Driver',
  pahinante: 'Pahinante',
  loader: 'Loader',
  guard: 'Guard',
  office: 'Office staff',
  sales: 'Sales',
  manager: 'Manager',
  present: 'Present',
  absent: 'Absent',
  half_day: 'Half day',
  daily: 'Daily',
  monthly: 'Monthly',
  semi_monthly: 'Semi-monthly',
  weekly: 'Weekly',
  regular: 'Regular holiday',
  special_nonworking: 'Special non-working',
  special_working: 'Special working',
  finalized: 'Finalized',
  per_liter: '₱ per liter',
  percent_of_sale: '% of sale',
  sil: 'Service Incentive Leave',
  vacation: 'Vacation',
  sick: 'Sick',
  unpaid: 'Unpaid',
}

/** "8:00 AM"-less plain "08:00–17:00" shift window. */
export function fmtShiftWindow(start: string, end: string) {
  return `${start}–${end}`
}

export function label(v: string) {
  return labels[v] ?? v
}
