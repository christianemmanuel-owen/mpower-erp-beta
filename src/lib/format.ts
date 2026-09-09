const peso = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 2 })
const num = new Intl.NumberFormat('en-PH', { maximumFractionDigits: 0 })

export function fmtCurrency(v: number) {
  return peso.format(v)
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
  pickup: 'Pick up',
  delivered: 'Delivered',
  delivery: 'Delivery',
  cash: 'Cash',
  check: 'Check',
  bank_transfer: 'Bank transfer',
  pending: 'Pending',
  collected: 'Collected',
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
