import { useMemo, useState } from 'react'
import { useToast } from '../../components/Toast'
import { useTables } from '../../lib/data'
import { repos } from '../../data/repo'
import { todayISO, fmtDate, fmtLiters, fmtTime } from '../../lib/format'
import { ExportButton, PrimaryButton, Card, InfoTip, KpiStrip, PageHeader } from '../../components/ui'
import { PendingBanner } from '../settings/Approvals'
import { exportTable } from '../../lib/exportXlsx'
import {
  MOVEMENT_LABELS, checklistProgress, deliveryPerformance, movementType,
  needsChecklist, scheduleDrift, wasOnTime,
} from '../../lib/logistics'
import type { Delivery, DeliveryStatus } from '../../data/types'
import TrackingMap from './TrackingMap'
import TripDrawer from './TripDrawer'
import { Maintenance, TruckBans } from './Fleet'
import { usePendingRecord } from '../../lib/deepLink'
import { useAuth } from '../../lib/auth'
import { isPending } from '../../lib/approvals'
import { STAGE_ACTION, advancePatch, receiptSlot, stageOf } from '../../lib/tripStages'

/**
 * Every state a trip can be in, including the one the board used to omit.
 *
 * `failed` is a DeliveryStatus and had no column, so a failed trip vanished
 * from the board while the strip above it counted the failures. There was
 * nowhere to look at one, and nowhere to reopen it.
 */
const columns: { status: DeliveryStatus; title: string }[] = [
  { status: 'scheduled', title: 'Scheduled' },
  { status: 'loading', title: 'Loading' },
  { status: 'in_transit', title: 'In transit' },
  { status: 'delivered', title: 'Delivered' },
  { status: 'failed', title: 'Failed' },
]

/** Cards rendered per column before the rest becomes a count. */
const PER_COLUMN = 10

const PAGE_TITLES = {
  board: 'Trips',
  maintenance: 'Vehicle maintenance',
  bans: 'Truck bans',
} as const

export default function Logistics({ page = 'board' }: { page?: 'board' | 'maintenance' | 'bans' }) {
  const [editing, setEditing] = useState<Delivery | null>(null)
  const toast = useToast()
  // Whose name goes on the stage stamp. Crew have no seats, so this is always
  // the office seat doing the recording - see StageStamp.
  const { seat } = useAuth()
  const [pendingRecord, clearPendingRecord] = usePendingRecord()

  const data = useTables(['deliveries', 'sales', 'customers', 'personnel', 'trucks', 'warehouses', 'vehicleMaintenance', 'truckBanRules'] as const)

  const targets = useMemo(() => {
    if (!data) return []
    return data.deliveries
      .filter((d) => d.status === 'in_transit')
      .map((d) => {
        const truck = data.trucks.find((t) => t.id === d.truckId)
        const sale = data.sales.find((s) => s.id === d.saleId)
        const wh = data.warehouses.find((w) => w.id === sale?.warehouseId)
        return {
          deliveryId: d.id,
          plateNumber: truck?.plateNumber ?? 'TRUCK',
          originLat: wh?.lat ?? 14.7,
          originLng: wh?.lng ?? 120.98,
        }
      })
  }, [data])

  /** Display detail for the tracking panel. Kept out of TrackingTarget, which
   * is the provider's contract and should not grow fields a real telematics
   * feed has no way to supply. */
  const trackingLabels = useMemo(() => {
    if (!data) return {}
    const out: Record<string, { customer: string; address: string; driver: string }> = {}
    for (const d of data.deliveries) {
      if (d.status !== 'in_transit') continue
      const sale = data.sales.find((x) => x.id === d.saleId)
      out[d.id] = {
        customer: data.customers.find((c) => c.id === sale?.customerId)?.company ?? '',
        address: d.deliveryAddress,
        driver: data.personnel.find((x) => x.id === d.driverId)?.name ?? '',
      }
    }
    return out
  }, [data])

  const depots = useMemo(
    () => (data ? data.warehouses.map((w) => ({ name: w.name, lat: w.lat, lng: w.lng })) : []),
    [data],
  )

  if (!data) return null
  const { deliveries, sales, customers, personnel, trucks, vehicleMaintenance, truckBanRules } = data

  // Exhibit A 1.1 - see the note in Sales.tsx.
  if (pendingRecord) {
    const found = deliveries.find((x) => x.id === pendingRecord)
    clearPendingRecord()
    if (found) setEditing(found)
  }

  const sale = (id: string) => sales.find((s) => s.id === id)
  const customerOf = (d: Delivery) => customers.find((c) => c.id === sale(d.saleId)?.customerId)
  const person = (id?: string) => personnel.find((p) => p.id === id)?.name
  const truckOf = (id?: string) => trucks.find((t) => t.id === id)?.plateNumber

  /**
   * The one place a trip changes stage.
   *
   * Both ends call this - the card's button and the drawer's stage action - so
   * a handoff cannot mean two different things depending on where it was
   * started. What it means (the status, the stamp, the completion time) is
   * advancePatch's business; what stays here is the part that needs this
   * page's data: marking a delivery delivered also closes out its sale.
   * "Fulfilled" mostly happens this way rather than by hand on the Sales page,
   * since a delivered truck is the real signal a delivery sale is done. Pickup
   * sales have no delivery to drive this off of, so they're closed out
   * manually on the Sales page instead.
   *
   * `extra` carries whatever is unsaved in the drawer, so confirming a delivery
   * files the receipt number typed a second earlier rather than dropping it.
   */
  async function advanceDelivery(d: Delivery, next: DeliveryStatus, extra?: Partial<Delivery>) {
    try {
      // Stamping the completion time is what makes on-time reporting possible
      // at all (Exhibit A 1.5). Without it a delivered trip can't be judged
      // early or late, and `deliveryPerformance` deliberately excludes it from
      // the ratio rather than guessing - so a missing stamp quietly shrinks the
      // sample the percentage is built on.
      const result = await repos.deliveries.update(d.id, advancePatch(d, next, seat, extra))
      // A parked write is not a moved trip. This used to go unchecked, so with
      // deliveries under approval the button did nothing and said nothing.
      if (isPending(result)) {
        toast(result.message)
        return
      }
      if (next === 'delivered') {
        const s = sales.find((x) => x.id === d.saleId)
        if (s && s.status !== 'fulfilled') await repos.sales.update(s.id, { status: 'fulfilled' })
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Couldn\u2019t move this trip on.')
    }
  }

  const perf = deliveryPerformance(deliveries)

  /** Secondary Feature 2.12 - the trip book as a spreadsheet. */
  function exportTrips() {
    exportTable('trips', 'Trips', [
      'Scheduled', 'Time', 'Movement', 'Status', 'Customer', 'Address',
      'Truck', 'Driver', 'Pahinante', 'Loader', 'Guard',
      'Requested', 'Days moved', 'Checklist', 'Completed', 'On time',
      'Delay reason', 'Not completed reason', 'Notes',
    ], deliveries.map((d) => {
      const onTime = wasOnTime(d)
      const progress = checklistProgress(d.checklist)
      return [
        d.scheduleDate.slice(0, 10),
        d.scheduleTime ?? '',
        MOVEMENT_LABELS[movementType(d)],
        d.status,
        customerOf(d)?.company ?? '',
        d.deliveryAddress,
        truckOf(d.truckId) ?? '',
        person(d.driverId) ?? '', person(d.pahinanteId) ?? '',
        person(d.loaderId) ?? '', person(d.guardId) ?? '',
        d.requestedDate ? d.requestedDate.slice(0, 10) : '',
        scheduleDrift(d),
        needsChecklist(d) ? `${progress.answered}/${progress.total}` : 'n/a',
        d.outcome?.completedAt ? d.outcome.completedAt.slice(0, 10) : '',
        onTime === null ? '' : onTime ? 'Yes' : 'No',
        d.outcome?.delayReason ?? '',
        d.outcome?.failureReason ?? '',
        d.outcome?.notes ?? '',
      ]
    }))
  }


  const today = todayISO()
  const recentCutoff = Date.now() - 7 * 86_400_000
  const board = columns.map((col) => {
    const all = deliveries
      .filter((d) => d.status === col.status && (col.status !== 'delivered' || Date.parse(d.scheduleDate) > recentCutoff))
      .sort((a, b) => a.scheduleDate.localeCompare(b.scheduleDate))
    // The header used to print items.length AFTER the slice, so a column
    // holding twenty-five trips reported ten. The count is the real one now
    // and the cards say what they are hiding.
    return { ...col, total: all.length, items: all.slice(0, PER_COLUMN) }
  })

  const pctText = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`)

  return (
    <>
      {/* Secondary Feature 2.1 - staff see their own parked inputs where they work. */}
      <PendingBanner tbl="deliveries" />
      <PageHeader
        title={PAGE_TITLES[page]}
        right={page === 'board' ? (
          <ExportButton onClick={exportTrips} />
        ) : undefined}
      />

      {page === 'maintenance' && <Maintenance />}
      {page === 'bans' && <TruckBans />}
      {page === 'board' && (
        <>

      {/* Exhibit A 1.5 - "percentage of deliveries on time and percentage
          completed". Kept on separate denominators: a trip that never happened
          is not late, it is not completed.

          Rendered through the shared KpiStrip rather than a hand-rolled row, so
          it has the dividers, weights and spacing every other headline band in
          the app has. It was the last set of figures still laid out by hand. */}
      <div className="mb-[18px]">
        <KpiStrip
          items={[
            {
              label: 'Completed',
              value: pctText(perf.completionRate),
              sub: `${perf.delivered} of ${perf.concluded} concluded · ${perf.failed} failed`,
            },
            {
              label: (
                <span className="inline-flex items-center gap-[5px]">
                  On time
                  {perf.delivered > perf.judged && (
                    <InfoTip label="Why the on-time figure is incomplete">
                      {perf.delivered - perf.judged} completed trip
                      {perf.delivered - perf.judged === 1 ? '' : 's'} have no completion time, so they sit
                      outside this figure. Open one and set the date to include it.
                    </InfoTip>
                  )}
                </span>
              ),
              value: pctText(perf.onTimeRate),
              sub: `${perf.onTime} on time · ${perf.late} late`,
            },
            ...(perf.overdueOpen > 0 ? [{
              label: 'Past due, still open',
              value: <span className="text-redtext">{perf.overdueOpen}</span>,
              sub: 'scheduled day has passed',
            }] : []),
          ]}
        />
      </div>

      {targets.length === 0 ? (
        <Card className="mb-[18px] p-4" delay={50}>
          <p className="m-0 py-16 text-center text-[13px] text-faint">
            No trucks in transit right now. Dispatch a loading trip to see it on the map.
          </p>
        </Card>
      ) : (
        <div className="mb-[18px]">
          <TrackingMap targets={targets} depots={depots} labels={trackingLabels} />
        </div>
      )}

      <div className="grid grid-cols-5 items-start gap-4">
        {board.map((col) => (
          <div key={col.status}>
            <div className="mb-[10px] flex items-baseline gap-2 border-b border-line pb-[7px]">
              <p className="m-0 text-[13px] font-semibold">{col.title}</p>
              <span className="ml-auto font-meta text-[12px] text-mut">{col.total}</span>
            </div>
            <div className="flex flex-col gap-2">
              {col.items.map((d) => {
                const s = sale(d.saleId)
                const c = customerOf(d)
                const plate = truckOf(d.truckId)
                // Same table the drawer's stage actions read, so the card and
                // the record cannot offer different next steps.
                const act = STAGE_ACTION[stageOf(d.status)]
                const day = d.scheduleDate.slice(0, 10)
                const late = day < today && d.status !== 'delivered' && d.status !== 'failed'
                  ? Math.round((Date.parse(today) - Date.parse(day)) / 86_400_000)
                  : 0
                const progress = needsChecklist(d) ? checklistProgress(d.checklist) : null
                // The checklist matters most on the card that is one click from
                // being dispatched. Elsewhere it is a record, not a warning.
                const dispatchImminent = d.status === 'scheduled' || d.status === 'loading'
                return (
                  <div key={d.id} className="rounded-[6px] border border-line bg-white p-3 transition-colors hover:border-inputline">
                    {/* Who and where, first. The load led the card before, which
                        told a dispatcher the least useful thing about it. */}
                    <div className="mb-[2px] flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{c?.company ?? 'No customer'}</span>
                      {late > 0 ? (
                        <span className="tnum shrink-0 font-meta text-[12px] font-semibold text-redtext">
                          {late}d late
                        </span>
                      ) : (
                        <span className="tnum shrink-0 font-meta text-[12px] text-faint">
                          {day === today ? fmtTime(d.scheduleDate) : fmtDate(d.scheduleDate).replace(', 2026', '')}
                        </span>
                      )}
                    </div>
                    <p className="m-0 truncate font-meta text-[12px] text-mut">{d.deliveryAddress}</p>
                    {d.movementType && d.movementType !== 'delivery_to_client' && (
                      <p className="m-0 mt-[2px] font-meta text-[12px] text-mut">{MOVEMENT_LABELS[d.movementType]}</p>
                    )}
                    <p className="m-0 mt-[6px] truncate font-meta text-[12px] text-mut">
                      <span className="tnum font-semibold text-lab">{s ? fmtLiters(s.volumeLiters) : '—'}</span>
                      {' · '}
                      <span className={plate ? '' : 'font-semibold text-redtext'}>{plate ?? 'No truck'}</span>
                      {' · '}
                      <span className={person(d.driverId) ? '' : 'font-semibold text-redtext'}>
                        {person(d.driverId) ?? 'No crew'}
                      </span>
                    </p>
                    {progress && !progress.complete && (
                      <p className={`m-0 mt-[4px] font-meta text-[12px] font-semibold ${dispatchImminent ? 'text-redtext' : 'text-mut'}`}>
                        Pre-dispatch {progress.answered}/{progress.total}
                      </p>
                    )}
                    {/* The same gap the drawer names beside Confirm delivery.
                        The card cannot see whether the scan is on file - that is
                        a query per trip - so it reports only the number, which
                        is the half a dispatcher can fix from here anyway. */}
                    {d.status === 'in_transit' && !d.documents?.[receiptSlot(d)]?.referenceNo && (
                      <p className="m-0 mt-[4px] font-meta text-[12px] font-semibold text-redtext">No receipt number yet</p>
                    )}
                    <div className="mt-[9px] flex gap-[6px]">
                      {act && <PrimaryButton size="sm" onClick={() => advanceDelivery(d, act.next)}>{act.label}</PrimaryButton>}
                      <button
                        onClick={() => setEditing(d)}
                        className="cursor-pointer rounded-[6px] border border-line bg-transparent px-[9px] py-[5px] font-meta text-[12px] font-semibold text-sec hover:bg-fill2 hover:text-ink"
                      >
                        Open
                      </button>
                    </div>
                  </div>
                )
              })}
              {col.total > col.items.length && (
                <p className="m-0 py-[6px] text-center font-meta text-[12px] text-mut">
                  {col.total - col.items.length} more
                </p>
              )}
              {col.total === 0 && (
                <p className="m-0 rounded-[6px] border border-dashed border-linesoft py-6 text-center font-meta text-[12px] text-faint">None</p>
              )}
            </div>
          </div>
        ))}
      </div>

        </>
      )}

      <TripDrawer
        delivery={editing}
        personnel={personnel}
        trucks={trucks}
        deliveries={deliveries}
        maintenance={vehicleMaintenance}
        banRules={truckBanRules}
        onClose={() => setEditing(null)}
        onNotice={toast}
        onAdvance={(next, patch) => advanceDelivery(editing as Delivery, next, patch)}
      />
    </>
  )
}

