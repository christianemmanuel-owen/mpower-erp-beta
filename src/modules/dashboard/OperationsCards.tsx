import { ModuleLink } from '../../components/ModuleLink'
import { Link } from 'react-router-dom'
import { Card, MiniDark } from '../../components/ui'
import { fmtCurrency, fmtDate, fmtLiters, fmtTime } from '../../lib/format'
import { recordHref } from '../../lib/deepLink'
import type {
  Customer, Delivery, Personnel, Purchase, Sale, Supplier, Truck, Warehouse,
} from '../../data/types'

/**
 * The two cards that carry Operations' movement half.
 *
 * Operations used to be four cards where one contained another. Today's trips
 * listed every open delivery with its crew, address and, for anything in
 * transit, its ETA; Truck ETA listed the in-transit ones again with less around
 * them. On live data that was three rows beside two rows already inside them.
 * Movements is the merge.
 *
 * Incoming is the opposite problem: nothing anywhere showed fuel on its way.
 * Stock said what was in the depots and trips said what was leaving, while a
 * purchase sitting unreceived for over a month appeared only as a number in the
 * page subtitle.
 */

/** Whole days between a date and today, negative when the date is still ahead. */
function daysLate(dateIso: string, today: string): number {
  const a = Date.parse(dateIso.slice(0, 10))
  const b = Date.parse(today)
  return Math.round((b - a) / 86_400_000)
}

const lateLabel = (days: number) => `${days} day${days === 1 ? '' : 's'} late`

/**
 * A divider between buckets. Never coloured.
 *
 * There is no Overdue heading, by design. Late rows open the list and carry
 * their lateness in the date itself, in red; a red band above them restated
 * the same fact one row earlier and made the card's first object a decoration
 * rather than data. What follows the late rows still needs naming, so Today
 * and Later keep quiet grey dividers - the eye reads "these are late, and the
 * rest start here" without a heading having to say it twice.
 *
 * Today also loses the amber it used to carry: a trip scheduled for today is
 * on time, and warning about the ordinary case is how a palette goes numb.
 */
function GroupHead({ tone, children }: { tone: 'watch' | 'plain'; children: string }) {
  const cls = tone === 'watch' ? 'text-sec' : 'text-faint'
  return (
    <p className={`m-0 border-b border-linesoft px-[14px] py-[5px] font-meta text-[10px] font-semibold uppercase tracking-[.09em] ${cls}`}>
      {children}
    </p>
  )
}

/** Bucket an open movement by when it was due, not by its status. A dispatcher
 * needs to know what is late before knowing what is loading. */
type Bucket = 'overdue' | 'today' | 'later'

const BUCKETS: { key: Bucket; label: string; tone: 'watch' | 'plain'; head: boolean }[] = [
  // Overdue is headless: the red date on each row says it, and says it on the
  // row that has to be acted on rather than above the block.
  { key: 'overdue', label: 'Overdue', tone: 'plain', head: false },
  { key: 'today', label: 'Today', tone: 'watch', head: true },
  { key: 'later', label: 'Later', tone: 'plain', head: true },
]

export function MovementsCard({
  deliveries, sales, customers, trucks, personnel, today, nowMs, etaLabel,
}: {
  deliveries: Delivery[]
  sales: Sale[]
  customers: Customer[]
  trucks: Truck[]
  personnel: Personnel[]
  today: string
  nowMs: number
  etaLabel: (d: Delivery, now: number) => string | null
}) {
  const open = deliveries
    .filter((d) => d.status !== 'delivered' && d.status !== 'failed')
    .sort((a, b) => a.scheduleDate.localeCompare(b.scheduleDate))

  const bucketOf = (d: Delivery): Bucket => {
    const day = d.scheduleDate.slice(0, 10)
    if (day < today) return 'overdue'
    if (day === today) return 'today'
    return 'later'
  }

  const saleOf = (d: Delivery) => sales.find((s) => s.id === d.saleId)
  const customerOf = (d: Delivery) => customers.find((c) => c.id === saleOf(d)?.customerId)

  return (
    <Card>
      <div className="flex items-center gap-[10px] border-b border-linesoft bg-paper px-[14px] py-[10px]">
        <span className="text-[13px] font-semibold">Movements</span>
{open.length > 0 && <span className="font-meta text-[12px] text-faint">{open.length}</span>}
        <ModuleLink to="/logistics" className="ml-auto" />
      </div>

      {open.length === 0 && (
        <p className="m-0 px-[14px] py-7 text-center text-[13px] text-faint">
          Every scheduled movement has been delivered.
        </p>
      )}

      {BUCKETS.map(({ key, label, tone, head }) => {
        const rows = open.filter((d) => bucketOf(d) === key)
        // 'Later' is only worth a heading when something sits in it; an empty
        // 'Today' is worth saying out loud, because a quiet day and a day whose
        // trips have not been entered look identical without it.
        if (rows.length === 0 && key !== 'today') return null
        if (rows.length === 0 && open.length === 0) return null
        return (
          <div key={key}>
            {head && <GroupHead tone={tone}>{label}</GroupHead>}
            {rows.length === 0 && (
              <p className="m-0 px-[14px] py-4 text-center font-meta text-[12px] text-faint">Nothing scheduled for today.</p>
            )}
            {rows.map((d) => {
              const sale = saleOf(d)
              const customer = customerOf(d)
              const truck = trucks.find((t) => t.id === d.truckId)
              const driver = personnel.find((p) => p.id === d.driverId)
              const missing = !truck || !driver
              const eta = etaLabel(d, nowMs)
              const etaLate = !!eta?.includes('overdue')
              const href = recordHref('deliveries', d.id)
              const late = daysLate(d.scheduleDate, today)
              return (
                <div key={d.id} className="flex items-center gap-3 border-b border-linesoft px-[14px] py-[9px] last:border-0">
                  <span className={`tnum w-[86px] shrink-0 font-meta text-[12px] ${key === 'overdue' ? 'font-semibold text-redtext' : 'text-mut'}`}>
                    {key === 'overdue' ? lateLabel(late) : fmtTime(d.scheduleDate)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold">
                      {href
                        ? <Link to={href} className="text-ink hover:underline">{customer?.company ?? d.deliveryAddress ?? 'Movement'}</Link>
                        : (customer?.company ?? d.deliveryAddress ?? 'Movement')}
                      {sale && <span className="font-normal text-mut"> · {fmtLiters(sale.volumeLiters)}</span>}
                    </span>
                    {missing ? (
                      <span className="mt-[1px] block font-meta text-[12px] font-semibold text-redtext">No crew assigned yet</span>
                    ) : (
                      <span className="mt-[1px] block truncate font-meta text-[12px] text-mut">
                        {truck?.plateNumber} · {driver?.name} · {d.deliveryAddress}
                      </span>
                    )}
                  </span>
                  <span className="w-[136px] shrink-0 text-right">
                    {missing ? (
                      <Link to="/logistics"><MiniDark>Assign</MiniDark></Link>
                    ) : (
                      <>
                        {/* These were filled chips - teal for in transit, amber
                            for loading - sitting in the row's action position.
                            That put the loudest object in the row on its least
                            urgent fact: which stage a trip is at is a status,
                            not a thing to do, and the lateness in the gutter is
                            what actually needs someone. Same words, no fill. */}
                        <span className="block whitespace-nowrap font-meta text-[10px] font-semibold uppercase tracking-[.09em] text-mut">
                          {d.status === 'in_transit' ? 'In transit' : d.status === 'loading' ? 'Loading' : 'Scheduled'}
                        </span>
                        {/* The ETA is entered by Logistics and stays blank when
                            they have not set one. The System does not estimate
                            it - that is 2.8, a Dependent Item. */}
                        {d.status === 'in_transit' && (
                          <span className={`tnum mt-[3px] block font-meta text-[12px] ${
                            eta ? (etaLate ? 'font-semibold text-redtext' : 'font-semibold text-sec') : 'text-faint'
                          }`}>
                            {eta ?? 'ETA not set'}
                          </span>
                        )}
                      </>
                    )}
                  </span>
                </div>
              )
            })}
          </div>
        )
      })}
    </Card>
  )
}

/**
 * Fuel ordered and not yet received.
 *
 * Grouped the same way Movements is, on the same reasoning: what is late
 * matters before what is merely outstanding. There is no expected-arrival field
 * on Purchase, so lateness is measured from the order date. That is a blunter
 * instrument, but "ordered five weeks ago and still not here" needs no
 * threshold to be worth surfacing.
 */
const STALE_DAYS = 14

export function IncomingCard({ purchases, suppliers, warehouses, today }: {
  purchases: Purchase[]
  suppliers: Supplier[]
  warehouses: Warehouse[]
  today: string
}) {
  const open = purchases
    .filter((p) => p.status === 'ordered')
    .sort((a, b) => a.date.localeCompare(b.date))

  const stale = open.filter((p) => daysLate(p.date, today) >= STALE_DAYS)
  const recent = open.filter((p) => daysLate(p.date, today) < STALE_DAYS)
  const totalVolume = open.reduce((sum, p) => sum + p.volumeLiters, 0)

  const row = (p: Purchase, isStale: boolean) => {
    const supplier = suppliers.find((s) => s.id === p.supplierId)
    const warehouse = warehouses.find((w) => w.id === p.warehouseId)
    const days = daysLate(p.date, today)
    const href = recordHref('purchases', p.id)
    return (
      <div key={p.id} className="flex items-center gap-3 border-b border-linesoft px-[14px] py-[9px] last:border-0">
        <span className={`tnum w-[74px] shrink-0 font-meta text-[12px] ${isStale ? 'font-semibold text-redtext' : 'text-mut'}`}>
          {days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'}`}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold">
            {href
              ? <Link to={href} className="text-ink hover:underline">{supplier?.name ?? 'Unknown supplier'}</Link>
              : (supplier?.name ?? 'Unknown supplier')}
            <span className="font-normal text-mut"> · {fmtLiters(p.volumeLiters)}</span>
          </span>
          <span className="mt-[1px] block truncate font-meta text-[12px] text-mut">
            Ordered {fmtDate(p.date)} · {p.fulfillment === 'pickup' ? 'pickup' : 'delivered'} to {warehouse?.name.replace(' depot', '') ?? 'unknown depot'} · {fmtCurrency(p.volumeLiters * p.pricePerLiter).replace('.00', '')}
          </span>
        </span>
        <span className="shrink-0">
          <Link to="/inventory/purchases"><MiniDark>Receive</MiniDark></Link>
        </span>
      </div>
    )
  }

  return (
    <Card>
      <div className="flex items-center gap-[10px] border-b border-linesoft bg-paper px-[14px] py-[10px]">
        <span className="text-[13px] font-semibold">Incoming</span>
{open.length > 0 && <span className="font-meta text-[12px] text-faint">{fmtLiters(totalVolume)}</span>}
        <ModuleLink to="/inventory/purchases" className="ml-auto" />
      </div>

      {open.length === 0 && (
        <p className="m-0 px-[14px] py-7 text-center text-[13px] text-faint">
          Nothing on order. Fuel on its way would appear here before it reaches a depot.
        </p>
      )}

      {/* Headless, as in Movements - the red age on each row is the marker. */}
      {stale.length > 0 && stale.map((p) => row(p, true))}
      {recent.length > 0 && (
        <>
          {stale.length > 0 && <GroupHead tone="plain">Recent</GroupHead>}
          {recent.map((p) => row(p, false))}
        </>
      )}
    </Card>
  )
}
