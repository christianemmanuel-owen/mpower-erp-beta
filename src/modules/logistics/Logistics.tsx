import { useMemo, useState } from 'react'
import { useToast } from '../../components/Toast'
import { useTables } from '../../lib/data'
import { repos } from '../../data/repo'
import { ExportButton, Card, KpiStrip, PageHeader, PageSkeleton } from '../../components/ui'
import { PendingBanner } from '../settings/Approvals'
import { exportTable } from '../../lib/exportXlsx'
import {
  trucksInMaintenance,
  MOVEMENT_LABELS, checklistProgress, deliveryPerformance, movementType,
  needsChecklist, scheduleDrift, wasOnTime,
} from '../../lib/logistics'
import type { Delivery, DeliveryStatus } from '../../data/types'
import TrackingMap from './TrackingMap'
import TripDrawer from './TripDrawer'
import TruckBoard from './TruckBoard'
import StatusBoard from './StatusBoard'
import { Maintenance, TruckBans } from './Fleet'
import { builtInRules, numberCodingSettings } from '../../lib/numberCoding'
import { usePendingRecord } from '../../lib/deepLink'
import { useAuth } from '../../lib/auth'
import { isPending } from '../../lib/approvals'
import { advancePatch } from '../../lib/tripStages'

/** The Trips page as three tabs rather than a map over a board: each is a
 *  full screen of its own, so the board and the schedule sit at the top
 *  without scrolling past the map to reach them. */
type TripsView = 'status' | 'truck' | 'map'
const VIEWS = [['status', 'Board'], ['truck', 'By truck'], ['map', 'Map']] as const

const PAGE_TITLES = {
  board: 'Trips',
  maintenance: 'Vehicle maintenance',
  bans: 'Coding & truck ban',
} as const

export default function Logistics({ page = 'board' }: { page?: 'board' | 'maintenance' | 'bans' }) {
  const [editing, setEditing] = useState<Delivery | null>(null)
  /** Status columns, or the fleet with its trips inside. Remembered per browser. */
  const [view, setView] = useState<TripsView>(() => {
    try {
      const v = localStorage.getItem('trips.view') as TripsView | null
      return v && VIEWS.some((x) => x[0] === v) ? v : 'status'
    } catch { return 'status' }
  })
  const pickView = (v: TripsView) => {
    setView(v)
    try { localStorage.setItem('trips.view', v) } catch { /* not remembered, still shown */ }
  }
  const toast = useToast()
  // Whose name goes on the stage stamp. Crew have no seats, so this is always
  // the office seat doing the recording - see StageStamp.
  const { seat } = useAuth()
  const [pendingRecord, clearPendingRecord] = usePendingRecord()

  const data = useTables(['deliveries', 'sales', 'customers', 'personnel', 'trucks', 'warehouses', 'vehicleMaintenance', 'truckBanRules', 'holidays', 'appSettings'] as const)

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

  if (!data) return <PageSkeleton />
  const { deliveries, sales, customers, personnel, trucks, vehicleMaintenance, truckBanRules, holidays, appSettings } = data
  // The regulations the app knows, ahead of the rules typed by hand, so a
  // coded plate is flagged on a fresh installation with an empty rules table.
  const codingSettings = numberCodingSettings(appSettings)
  const allBanRules = [...builtInRules(codingSettings), ...truckBanRules]
  const holidayDates = holidays.map((h) => h.date.slice(0, 10))

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
      // Marking it delivered also closes out the sale, but that happens on the
      // server (server/fulfilment.ts), in the same write as the trip - so the
      // driver's phone and this page finish a sale the same way, and there is
      // no second request to be parked for approval on its own.
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


  const pctText = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`)

  return (
    <>
      {/* Secondary Feature 2.1 - staff see their own parked inputs where they work. */}
      <PendingBanner tbl="deliveries" />
      <PageHeader
        title={PAGE_TITLES[page]}
        right={page === 'board' ? (
          <>
            <span className="flex gap-[2px] rounded-[6px] bg-fill2 p-[2px]" role="tablist" aria-label="View">
              {VIEWS.map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={view === k}
                  onClick={() => pickView(k)}
                  className={`cursor-pointer rounded-[4px] border-0 px-[11px] py-[3px] font-meta text-[12px] transition-colors ${
                    view === k ? 'bg-white font-semibold text-ink shadow-[0_1px_2px_rgba(20,24,27,.05)]' : 'bg-transparent text-mut hover:text-ink'
                  }`}
                >
                  {k === 'map' && targets.length > 0 && (
                    /* A live dot ahead of the word, like a recording light:
                       trucks are moving right now. The count follows the label. */
                    <span className="relative mr-[6px] inline-flex h-[7px] w-[7px]" aria-hidden>
                      <span className="absolute inline-flex h-full w-full rounded-full bg-tealbright opacity-60 motion-safe:animate-ping" />
                      <span className="relative inline-flex h-[7px] w-[7px] rounded-full bg-tealbright" />
                    </span>
                  )}
                  {label}
                  {k === 'map' && targets.length > 0 && (
                    <span className="tnum ml-[5px] text-[11px] font-semibold text-tealtext" aria-label={`${targets.length} on the road`}>{targets.length}</span>
                  )}
                </button>
              ))}
            </span>
            <ExportButton onClick={exportTrips} />
          </>
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
              label: 'On time',
              tip: perf.delivered > perf.judged ? {
                label: 'Why the on-time figure is incomplete',
                body: (
                  <>
                    {perf.delivered - perf.judged} completed trip
                    {perf.delivered - perf.judged === 1 ? '' : 's'} have no completion time, so they sit
                    outside this figure. Open one and set the date to include it.
                  </>
                ),
              } : undefined,
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

      {view === 'map' && (targets.length === 0 ? (
        <Card className="p-4" delay={50}>
          <p className="m-0 py-16 text-center text-[13px] text-faint">
            No trucks in transit right now. Dispatch a loading trip to see it on the map.
          </p>
        </Card>
      ) : (
        <TrackingMap targets={targets} depots={depots} labels={trackingLabels} height={600} />
      ))}

      {view === 'truck' && (
        <TruckBoard
          trucks={trucks}
          deliveries={deliveries}
          customerOf={(d) => customerOf(d)?.company}
          driverOf={(d) => person(d.driverId)}
          litersOf={(d) => sale(d.saleId)?.volumeLiters}
          workshopOn={(d) => trucksInMaintenance(vehicleMaintenance, d)}
          onAssign={async (d, patch) => {
            try {
              // null, not undefined: JSON drops an undefined key, and the
              // server merges the body over the row, so an unbook that sent
              // nothing changed nothing.
              const result = await repos.deliveries.update(d.id, patch as Partial<Delivery>)
              if (isPending(result)) toast(result.message)
            } catch (e) {
              toast(e instanceof Error ? e.message : 'Couldn’t move this trip.')
            }
          }}
          onAdvance={(d, next) => advanceDelivery(d, next)}
          onOpen={setEditing}
        />
      )}

      {view === 'status' && (
        <StatusBoard
          deliveries={deliveries}
          customerOf={(d) => customerOf(d)?.company}
          driverOf={(d) => person(d.driverId)}
          plateOf={(d) => truckOf(d.truckId)}
          litersOf={(d) => sale(d.saleId)?.volumeLiters}
          onAdvance={(d, next) => advanceDelivery(d, next)}
          onOpen={setEditing}
        />
      )}

        </>
      )}

      <TripDrawer
        delivery={editing}
        personnel={personnel}
        trucks={trucks}
        deliveries={deliveries}
        maintenance={vehicleMaintenance}
        banRules={allBanRules}
        holidays={holidayDates}
        liters={editing ? sale(editing.saleId)?.volumeLiters : undefined}
        checks={codingSettings}
        origin={(() => {
          // The depot the sale draws from is where the truck sets off.
          if (!editing) return undefined
          const wh = data.warehouses.find((w) => w.id === sale(editing.saleId)?.warehouseId)
          if (!wh) return undefined
          return { label: wh.name, query: wh.lat && wh.lng ? `${wh.lat},${wh.lng}` : wh.address, point: wh.lat && wh.lng ? { lat: wh.lat, lng: wh.lng } : undefined }
        })()}
        onClose={() => setEditing(null)}
        onNotice={toast}
        onAdvance={(next, patch) => advanceDelivery(editing as Delivery, next, patch)}
      />
    </>
  )
}

