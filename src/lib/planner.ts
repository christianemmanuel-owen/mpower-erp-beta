import { eachDayOfInterval } from 'date-fns'
import {
  isInstallmentOverdue, openReceivables, purchaseInstallmentEntries, undepositedItems,
} from './metrics'
import { RECORD_PARAM, recordHref } from './deepLink'
import { label } from './format'
import type {
  Customer, Delivery, LeaveRecord, Personnel, Purchase, Sale, Supplier, Truck, VehicleMaintenance,
} from '../data/types'

/**
 * Everything with a date on it, on one grid.
 *
 * The dashboard had a cash calendar and Trips had a board and Treasury had a
 * queue sorted by the day a check could be banked, and a manager read all
 * three to answer one question: what happens this week. They are the same
 * customers - the truck that delivers on Tuesday is the collection due on the
 * 30th - so they belong on one page. This file turns the tables into one flat
 * list of dated events; the Planner component draws it.
 *
 * Each event carries where to go about it. The calendar never writes: a
 * collection needs a date and a reference, a deposit needs a slip number, a
 * trip needs its checklist, and each module's own dialog asks for those. The
 * calendar's job is to put the day in front of the right person and hand over.
 */

export type PlannerLayer = 'trips' | 'in' | 'out' | 'bank' | 'fleet' | 'people'

export const LAYERS: { key: PlannerLayer; label: string; group: string }[] = [
  { key: 'trips', label: 'Trips', group: 'Operations' },
  { key: 'in', label: 'To collect', group: 'Money' },
  { key: 'bank', label: 'To bank', group: 'Money' },
  { key: 'out', label: 'To pay', group: 'Money' },
  { key: 'fleet', label: 'Maintenance', group: 'Fleet & people' },
  { key: 'people', label: 'Leave', group: 'Fleet & people' },
]

export interface PlannerEvent {
  id: string
  layer: PlannerLayer
  /** yyyy-MM-dd. A multi-day item (maintenance, leave) is one event per day. */
  date: string
  title: string
  sub?: string
  amount?: number
  /** Past its day and still open. */
  overdue: boolean
  /** Where to act on it. Null when nothing opens it (a leave, say). */
  href: string | null
  /** For the day panel's grouping and the week view's ordering. */
  truckId?: string
}

export interface PlannerSources {
  sales?: Sale[]
  purchases?: Purchase[]
  deliveries?: Delivery[]
  customers?: Customer[]
  suppliers?: Supplier[]
  trucks?: Truck[]
  personnel?: Personnel[]
  vehicleMaintenance?: VehicleMaintenance[]
  leaves?: LeaveRecord[]
}

const day = (iso: string) => iso.slice(0, 10)

/** Every day from `from` to `to` inclusive, as yyyy-MM-dd. */
function span(from: string, to: string | undefined): string[] {
  const start = new Date(`${day(from)}T00:00:00`)
  const end = new Date(`${day(to || from)}T00:00:00`)
  if (Number.isNaN(start.getTime())) return []
  if (Number.isNaN(end.getTime()) || end < start) return [day(from)]
  return eachDayOfInterval({ start, end }).map((d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
}

/**
 * The flat list. `layers` limits what is built, so a screen that only wants
 * money does not pay for trips. `today` is injectable for tests.
 */
export function plannerEvents(
  src: PlannerSources,
  layers: readonly PlannerLayer[] = LAYERS.map((l) => l.key),
  today = new Date().toISOString().slice(0, 10),
): PlannerEvent[] {
  const want = new Set(layers)
  const out: PlannerEvent[] = []
  const customer = (id: string) => src.customers?.find((c) => c.id === id)?.company ?? '—'
  const supplier = (id: string) => src.suppliers?.find((s) => s.id === id)?.name ?? '—'
  const plate = (id?: string) => (id ? src.trucks?.find((t) => t.id === id)?.plateNumber : undefined)
  const person = (id?: string) => (id ? src.personnel?.find((p) => p.id === id)?.name : undefined)

  if (want.has('trips') && src.deliveries) {
    for (const d of src.deliveries) {
      if (d.status !== 'scheduled' && d.status !== 'loading' && d.status !== 'in_transit') continue
      const sale = src.sales?.find((s) => s.id === d.saleId)
      const who = person(d.driverId)
      const p = plate(d.truckId)
      out.push({
        id: `trip:${d.id}`,
        layer: 'trips',
        date: day(d.scheduleDate),
        title: sale ? customer(sale.customerId) : d.deliveryAddress || 'Trip',
        sub: [p ?? 'No truck', who ? who.split(' ')[0] : 'No driver', label(d.status)].join(' · '),
        amount: sale?.volumeLiters,
        overdue: day(d.scheduleDate) < today,
        href: recordHref('deliveries', d.id),
        truckId: d.truckId,
      })
    }
  }

  if (want.has('in') && src.sales) {
    for (const e of openReceivables(src.sales)) {
      out.push({
        id: `in:${e.sale.id}:${e.installment.id}`,
        layer: 'in',
        date: day(e.installment.dueDate),
        title: customer(e.sale.customerId),
        sub: `${label(e.sale.paymentMode)}${e.installment.collectorId && person(e.installment.collectorId) ? ` · ${person(e.installment.collectorId)}` : ''}`,
        amount: e.installment.amount,
        overdue: isInstallmentOverdue(e.installment),
        // The settle dialog, on this installment - it asks for the date and
        // the reference the calendar cannot.
        href: `/collection?${RECORD_PARAM}=${encodeURIComponent(`${e.sale.id}::${e.installment.id}`)}`,
      })
    }
  }

  // The day a check in the drawer can go to the bank. This date existed only
  // as the sort order of the Treasury queue; it is the one Treasury date that
  // is actually a plan rather than a record.
  if (want.has('bank') && src.sales) {
    for (const e of undepositedItems(src.sales)) {
      if (e.sale.paymentMode !== 'check') continue
      out.push({
        id: `bank:${e.sale.id}:${e.installment.id}`,
        layer: 'bank',
        date: day(e.depositDue),
        title: customer(e.sale.customerId),
        sub: e.installment.referenceNo ? `Check ${e.installment.referenceNo}` : 'Check',
        amount: e.installment.amount,
        overdue: day(e.depositDue) < today,
        href: '/treasury',
      })
    }
  }

  if (want.has('out') && src.purchases) {
    for (const e of purchaseInstallmentEntries(src.purchases)) {
      if (e.installment.status !== 'pending') continue
      out.push({
        id: `out:${e.purchase.id}:${e.installment.id}`,
        layer: 'out',
        date: day(e.installment.dueDate),
        title: supplier(e.purchase.supplierId),
        sub: e.purchase.poReferenceNo ? `PO ${e.purchase.poReferenceNo}` : undefined,
        amount: e.installment.amount,
        overdue: isInstallmentOverdue(e.installment),
        href: '/treasury/payables',
      })
    }
  }

  if (want.has('fleet') && src.vehicleMaintenance) {
    for (const m of src.vehicleMaintenance) {
      if (m.status !== 'scheduled' && m.status !== 'in_progress') continue
      for (const d of span(m.scheduledDate, m.endDate)) {
        out.push({
          id: `fleet:${m.id}:${d}`,
          layer: 'fleet',
          date: d,
          title: plate(m.truckId) ?? 'Truck',
          sub: `${label(m.kind)}${m.vendor ? ` · ${m.vendor}` : ''}`,
          overdue: m.status === 'scheduled' && day(m.scheduledDate) < today,
          href: '/logistics/maintenance',
          truckId: m.truckId,
        })
      }
    }
  }

  if (want.has('people') && src.leaves) {
    for (const l of src.leaves) {
      for (const d of span(l.dateFrom, l.dateTo)) {
        out.push({
          id: `people:${l.id}:${d}`,
          layer: 'people',
          date: d,
          title: person(l.employeeId) ?? 'Someone',
          sub: 'On leave',
          overdue: false,
          href: recordHref('personnel', l.employeeId),
        })
      }
    }
  }

  // Within a day: the modules' order (trips first, then money, then the
  // fleet and people), not alphabetical - a dispatcher's week reads trucks
  // at the top of every column.
  const rank = (l: PlannerLayer) => LAYERS.findIndex((x) => x.key === l)
  return out.sort((a, b) => a.date.localeCompare(b.date) || rank(a.layer) - rank(b.layer) || a.title.localeCompare(b.title))
}

/** Events keyed by day - what the grid draws from. */
export function byDay(events: PlannerEvent[]): Map<string, PlannerEvent[]> {
  const map = new Map<string, PlannerEvent[]>()
  for (const e of events) {
    const list = map.get(e.date) ?? []
    list.push(e)
    map.set(e.date, list)
  }
  return map
}
