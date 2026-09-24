import { Fragment, useState } from 'react'
import { ChevronDown, ChevronRight, Plus, Settings2 } from 'lucide-react'
import {
  Card, DataTable, Dialog, Field, GhostButton, Input, MiniDark, PrimaryButton, Select, Switch, td, RowAction,
} from '../../components/ui'
import { useTables } from '../../lib/data'
import { ModuleLink } from '../../components/ModuleLink'
import { recordHref } from '../../lib/deepLink'
import { useToast } from '../../components/Toast'
import { repos } from '../../data/repo'
import { todayISO, fmtCurrency, fmtDate } from '../../lib/format'
import { bansFor, daysUntil, maintenanceCovers, tripDeparture, tripHours } from '../../lib/logistics'
import { AXLE_CONFIGS, MAX_AXLE_LOAD_KG, TOLL_CLASS_LIMITS, VEHICLE_LIMITS_AS_OF } from '../../lib/vehicleLimits'
import { ZONE_LABELS } from '../../lib/zones'
import {
  CODING_DIGITS, CODING_RULES_AS_OF, FUEL_EXEMPTION, PRESETS, TRUCK_BAN_GVW_KG, WEEKDAY_NAMES, NUMBER_CODING_KEY,
  builtInRules, codingWeekdayFor, fuelExemptionStale, isHeavyTruck, isPresetOn, numberCodingSettings, type NumberCodingSettings, type Preset, type PresetKey,
} from '../../lib/numberCoding'
import type { MaintenanceKind, MaintenanceStatus } from '../../data/types'

/**
 * The two halves of Exhibit A 1.5 that had a data model and no way in.
 *
 * `vehicleMaintenance` and `truckBanRules` have had types, repos and table
 * registration since the model was written, and no component ever referenced
 * either. Both tables were empty, which is what a feature with no UI looks like
 * from the database: indistinguishable from one nobody uses.
 */

const KINDS: MaintenanceKind[] = ['preventive', 'repair', 'inspection', 'registration']
const KIND_LABELS: Record<MaintenanceKind, string> = {
  preventive: 'Preventive service',
  repair: 'Repair',
  inspection: 'Inspection',
  registration: 'Registration',
}
const STATUSES: MaintenanceStatus[] = ['scheduled', 'in_progress', 'done', 'cancelled']
const STATUS_LABELS: Record<MaintenanceStatus, string> = {
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  done: 'Done',
  cancelled: 'Cancelled',
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// ---- Vehicle maintenance ----------------------------------------------------

export function Maintenance() {
  const data = useTables(['vehicleMaintenance', 'trucks', 'deliveries'] as const)
  const [adding, setAdding] = useState(false)

  if (!data) return <Card className="p-6"><p className="m-0 text-[13px] text-faint">Loading…</p></Card>
  const { vehicleMaintenance, trucks } = data
  const today = todayISO()

  const plate = (id: string) => trucks.find((t) => t.id === id)?.plateNumber ?? 'Unknown truck'

  /** Open work first, soonest first; finished work after it, newest first. A
   * schedule is read forwards, a history backwards. */
  const open = vehicleMaintenance
    .filter((m) => m.status === 'scheduled' || m.status === 'in_progress')
    .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate))
  const closed = vehicleMaintenance
    .filter((m) => m.status === 'done' || m.status === 'cancelled')
    .sort((a, b) => b.scheduledDate.localeCompare(a.scheduledDate))

  const offRoadToday = trucks.filter((t) =>
    vehicleMaintenance.some((m) => m.truckId === t.id && maintenanceCovers(m, today)))

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex items-center gap-[10px] border-b border-linesoft px-[14px] py-[10px]">
          <span className="text-[13px] font-semibold">Off the road today</span>
          <span className="ml-auto font-meta text-[12px] text-mut">
            {offRoadToday.length} of {trucks.length}
          </span>
        </div>
        {offRoadToday.length === 0 ? (
          <p className="m-0 px-[14px] py-5 text-center text-[13px] text-faint">
            Every truck is available today.
          </p>
        ) : (
          offRoadToday.map((t) => {
            const job = vehicleMaintenance.find((m) => m.truckId === t.id && maintenanceCovers(m, today))
            return (
              <div key={t.id} className="flex items-center gap-3 border-b border-linesoft px-[14px] py-[9px] last:border-0">
                <span className="w-[104px] shrink-0 text-[13px] font-semibold">{t.plateNumber}</span>
                <span className="flex-1 font-meta text-[12px] text-mut">
                  {job ? KIND_LABELS[job.kind] : '—'}{job?.vendor ? ` · ${job.vendor}` : ''}
                </span>
                <span className="font-meta text-[12px] font-semibold text-ambertext">
                  {job?.endDate ? `until ${fmtDate(job.endDate)}` : 'today'}
                </span>
              </div>
            )
          })
        )}
      </Card>

      <AddMaintenance trucks={trucks} open={adding} onDone={() => setAdding(false)} />

      <Card>
        <div className="flex items-center gap-[10px] border-b border-linesoft px-[14px] py-[10px]">
          <span className="text-[13px] font-semibold">Scheduled work</span>
          {open.length > 0 && <span className="font-meta text-[12px] text-mut">{open.length}</span>}
          {!adding && (
            <span className="ml-auto">
              <MiniDark onClick={() => setAdding(true)}>
                <span className="flex items-center gap-1"><Plus size={12} /> Book work</span>
              </MiniDark>
            </span>
          )}
        </div>


        <DataTable
          cols={[
            { label: 'Truck' }, { label: 'Work' }, { label: 'From' }, { label: 'To' },
            { label: 'Due in', align: 'right' as const },
            { label: 'Cost', align: 'right' as const },
            { label: 'Status' }, { label: '', align: 'right' as const },
          ]}
          empty="Nothing booked. A truck with no service history is not a truck that needs none."
        >
          {open.map((m) => {
            const due = daysUntil(m.scheduledDate, today)
            return (
              <tr key={m.id}>
                <td className={td}>{plate(m.truckId)}</td>
                <td className={td}>{KIND_LABELS[m.kind]}{m.vendor ? <span className="text-mut"> · {m.vendor}</span> : null}</td>
                <td className={td}>{fmtDate(m.scheduledDate)}</td>
                <td className={td}>{m.endDate ? fmtDate(m.endDate) : '—'}</td>
                <td className={`${td} text-right tnum`}>
                  {due < 0
                    ? <span className="font-semibold text-redtext">{Math.abs(due)}d overdue</span>
                    : due === 0 ? <span className="font-semibold text-ambertext">today</span> : `${due}d`}
                </td>
                <td className={`${td} text-right tnum`}>{m.cost ? fmtCurrency(m.cost).replace('.00', '') : '—'}</td>
                <td className={td}>
                  <Select
                    value={m.status}
                    onChange={(e) => repos.vehicleMaintenance.update(m.id, { status: e.target.value as MaintenanceStatus })}
                  >
                    {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                  </Select>
                </td>
                <td className={`${td} text-right`}>
                  <RowAction verb="delete" label="Remove this booking" onClick={() => repos.vehicleMaintenance.remove(m.id)} />
                </td>
              </tr>
            )
          })}
        </DataTable>
      </Card>

      {closed.length > 0 && (
        <Card>
          <div className="flex items-center gap-[10px] border-b border-linesoft px-[14px] py-[10px]">
            <span className="text-[13px] font-semibold">History</span>
            <span className="ml-auto font-meta text-[12px] text-mut">{closed.length}</span>
          </div>
          <DataTable
            cols={[
              { label: 'Truck' }, { label: 'Work' }, { label: 'Date' },
              { label: 'Odometer', align: 'right' as const },
              { label: 'Cost', align: 'right' as const },
              { label: 'Status' },
            ]}
            empty=""
            pageSize={10}
          >
            {closed.map((m) => (
              <tr key={m.id}>
                <td className={td}>{plate(m.truckId)}</td>
                <td className={td}>{KIND_LABELS[m.kind]}{m.vendor ? <span className="text-mut"> · {m.vendor}</span> : null}</td>
                <td className={td}>{fmtDate(m.scheduledDate)}</td>
                <td className={`${td} text-right tnum`}>{m.odometerKm ? `${m.odometerKm.toLocaleString()} km` : '—'}</td>
                <td className={`${td} text-right tnum`}>{m.cost ? fmtCurrency(m.cost).replace('.00', '') : '—'}</td>
                <td className={td}><span className="font-meta text-[12px] text-mut">{STATUS_LABELS[m.status]}</span></td>
              </tr>
            ))}
          </DataTable>
        </Card>
      )}
    </div>
  )
}

function AddMaintenance({ trucks, open, onDone }: {
  trucks: { id: string; plateNumber: string }[]
  open: boolean
  onDone: () => void
}) {
  const [truckId, setTruckId] = useState(trucks[0]?.id ?? '')
  const [kind, setKind] = useState<MaintenanceKind>('preventive')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [vendor, setVendor] = useState('')
  const [cost, setCost] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (!truckId || !from) {
      setError('A booking needs a truck and a start date.')
      return
    }
    if (to && to < from) {
      setError('The end date is before the start date.')
      return
    }
    await repos.vehicleMaintenance.add({
      truckId,
      kind,
      status: 'scheduled',
      scheduledDate: new Date(`${from}T00:00:00`).toISOString(),
      ...(to ? { endDate: new Date(`${to}T00:00:00`).toISOString() } : {}),
      ...(vendor.trim() ? { vendor: vendor.trim() } : {}),
      ...(Number(cost) > 0 ? { cost: Number(cost) } : {}),
    })
    onDone()
  }

  return (
    <Dialog
      open={open}
      title="Book maintenance"
      width={560}
      onClose={onDone}
      footer={
        <>
          <PrimaryButton onClick={save}>Book it</PrimaryButton>
          <GhostButton onClick={onDone}>Cancel</GhostButton>
          {error && <span className="ml-auto font-meta text-[12px] font-semibold text-redtext">{error}</span>}
        </>
      }
    >
      <div className="grid grid-cols-2 gap-x-4 gap-y-[14px]">
        <Field label="Truck">
          <Select value={truckId} onChange={(e) => setTruckId(e.target.value)}>
            {trucks.map((t) => <option key={t.id} value={t.id}>{t.plateNumber}</option>)}
          </Select>
        </Field>
        <Field label="Work">
          <Select value={kind} onChange={(e) => setKind(e.target.value as MaintenanceKind)}>
            {KINDS.map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
          </Select>
        </Field>
        <Field label="From">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To" hint="Leave blank for a single day.">
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Field label="Vendor">
          <Input value={vendor} placeholder="e.g. Petron Bulacan" onChange={(e) => setVendor(e.target.value)} />
        </Field>
        <Field label="Cost (₱)">
          <Input type="number" min={0} value={cost} onChange={(e) => setCost(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  )
}

// ---- Truck ban and colour coding --------------------------------------------

export function TruckBans() {
  const data = useTables(['truckBanRules', 'trucks', 'deliveries', 'holidays', 'appSettings'] as const)
  const [adding, setAdding] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const toast = useToast()

  if (!data) return <Card className="p-6"><p className="m-0 text-[13px] text-faint">Loading…</p></Card>
  const { truckBanRules, trucks, deliveries, holidays, appSettings } = data

  const settings = numberCodingSettings(appSettings)
  const holidayDates = holidays.map((h) => h.date.slice(0, 10))
  // The regulations the app knows come first: they apply whether or not anyone
  // has typed a rule, which is the point of knowing them.
  const allRules = [...builtInRules(settings), ...truckBanRules]

  /** Open trips whose scheduled moment lands inside a rule. This is the whole
   * point of keeping the table: a rule nobody checks against a trip is a
   * document, not a control. */
  const clashes = deliveries
    .filter((d) => d.status !== 'delivered' && d.status !== 'failed' && d.truckId)
    .map((d) => {
      const truck = trucks.find((t) => t.id === d.truckId)
      const hits = truck
        ? bansFor(allRules, truck.plateNumber, tripDeparture(d).toISOString(), { heavy: isHeavyTruck(truck), holidays: holidayDates, zones: d.travelEstimate?.zones, hours: tripHours(d) })
        : []
      return { delivery: d, truck, hits }
    })
    .filter((c) => c.hits.length > 0)

  async function saveSettings(patch: Partial<NumberCodingSettings>) {
    const row = appSettings.find((r) => r.key === NUMBER_CODING_KEY)
    const next: NumberCodingSettings = {
      ...settings,
      ...patch,
      enabled: { ...settings.enabled, ...(patch.enabled ?? {}) },
    }
    try {
      if (row) await repos.appSettings.update(row.id, { value: next })
      else await repos.appSettings.add({ key: NUMBER_CODING_KEY, value: next })
    } catch (e) {
      // Only administrators may write system settings; say so rather than
      // leaving a switch that snaps back with no explanation.
      toast(e instanceof Error ? e.message : 'Only an administrator can change these settings.')
    }
  }
  const togglePreset = (key: PresetKey, on: boolean) => saveSettings({ enabled: { [key]: on } })

  return (
    <div className="flex flex-col gap-4">
      <CodingSchedule trucks={trucks} settings={settings} onSettings={() => setSettingsOpen(true)} />
      <Regulations
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onToggle={togglePreset}
        onFlag={(key, on) => saveSettings({ [key]: on })}
      />
      {clashes.length > 0 && (
        <Card>
          <div className="flex items-center gap-[10px] border-b border-linesoft px-[14px] py-[10px]">
            <span className="text-[13px] font-semibold text-redtext">Trips scheduled into a ban</span>
            <span className="font-meta text-[12px] text-mut">{clashes.length}</span>
            <span className="ml-auto font-meta text-[12px] text-faint">Move the departure, or send a different truck</span>
          </div>
          {/* One row per trip, one chip per rule it runs into, and the time
              it would have to leave to miss all of them - the number the
              dispatcher actually needs, rather than a sentence to parse. */}
          <DataTable
            cols={[
              { label: 'Leaves' }, { label: 'Truck' }, { label: 'Destination' },
              { label: 'Runs into' }, { label: 'Clear after' }, { label: '', align: 'right' as const },
            ]}
          >
            {clashes.map(({ delivery, truck, hits }) => {
              const at = new Date(delivery.scheduleDate)
              const leaves = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
              const clearAfter = hits.map((h) => h.endTime).sort().at(-1)
              const href = recordHref('deliveries', delivery.id)
              return (
                <tr key={delivery.id} className="group hover:bg-hovrow">
                  <td className={`${td} whitespace-nowrap pl-5`}>
                    <p className="m-0 font-semibold text-redtext">{fmtDate(delivery.scheduleDate)}</p>
                    <p className="tnum m-0 font-meta text-[12px] text-mut">{leaves}</p>
                  </td>
                  <td className={`${td} whitespace-nowrap font-semibold`}>{truck?.plateNumber}</td>
                  <td className={`${td} max-w-[260px]`}>
                    <p className="m-0 truncate">{delivery.deliveryAddress || '—'}</p>
                  </td>
                  <td className={td}>
                    <span className="flex flex-wrap gap-[4px]">
                      {hits.map((h) => (
                        <span
                          key={h.id}
                          title={h.area}
                          className="inline-flex items-center gap-[5px] rounded-[5px] border border-redf/30 bg-redbadge px-[7px] py-[2px] font-meta text-[11px] font-semibold text-redtext"
                        >
                          {h.authority}
                          <span className="tnum font-normal opacity-80">{h.startTime}–{h.endTime}</span>
                        </span>
                      ))}
                    </span>
                    <p className="m-0 mt-[3px] truncate font-meta text-[11px] text-faint">
                      {[...new Set(hits.map((h) => h.area))].join(' · ')}
                    </p>
                  </td>
                  <td className={`${td} tnum whitespace-nowrap font-semibold text-tealtext`}>{clearAfter ?? '—'}</td>
                  <td className={`${td} pr-4 text-right`}>
                    {href && <ModuleLink to={href} destination="the trip" reveal />}
                  </td>
                </tr>
              )
            })}
          </DataTable>
        </Card>
      )}

      <AddBanRule open={adding} onDone={() => setAdding(false)} />

      <Card>
        <div className="flex items-center gap-[10px] border-b border-linesoft px-[14px] py-[10px]">
          <span className="text-[13px] font-semibold">Additional rules</span>
          {truckBanRules.length > 0 && <span className="font-meta text-[12px] text-mut">{truckBanRules.length}</span>}
          {!adding && (
            <span className="ml-auto">
              <MiniDark onClick={() => setAdding(true)}>
                <span className="flex items-center gap-1"><Plus size={12} /> Add rule</span>
              </MiniDark>
            </span>
          )}
        </div>


        <DataTable
          cols={[
            { label: 'Authority' }, { label: 'Area' }, { label: 'Days' },
            { label: 'Window' }, { label: 'Plates ending' }, { label: 'Active' },
            { label: '', align: 'right' as const },
          ]}
          empty="No additional rules. The regulations above apply on their own; add a rule here for a local ordinance or a route-specific ban."
        >
          {truckBanRules.map((r) => (
            <tr key={r.id} className={r.active === false ? 'opacity-50' : ''}>
              <td className={td}>{r.authority}</td>
              <td className={td}>{r.area}</td>
              <td className={td}>
                <span className="font-meta text-[12px]">
                  {r.weekdays.length === 7 ? 'Every day' : r.weekdays.map((w) => WEEKDAYS[w]).join(', ')}
                </span>
              </td>
              <td className={`${td} tnum`}>{r.startTime}–{r.endTime}</td>
              <td className={td}>
                {/* An empty list is a blanket ban, not an inert rule. Saying
                    "all plates" out loud stops it reading as unfinished. */}
                <span className="font-meta text-[12px]">
                  {r.plateEndsWith.length === 0
                    ? <span className="font-semibold text-ambertext">All plates</span>
                    : r.plateEndsWith.join(', ')}
                </span>
              </td>
              <td className={td}>
                <button
                  type="button"
                  onClick={() => repos.truckBanRules.update(r.id, { active: r.active === false })}
                  className="cursor-pointer font-meta text-[12px] font-semibold text-tealtext hover:underline"
                >
                  {r.active === false ? 'Off' : 'On'}
                </button>
              </td>
              <td className={`${td} text-right`}>
                <RowAction verb="delete" label="Remove this rule" onClick={() => repos.truckBanRules.remove(r.id)} />
              </td>
            </tr>
          ))}
        </DataTable>
      </Card>
    </div>
  )
}

function AddBanRule({ open, onDone }: { open: boolean; onDone: () => void }) {
  const [authority, setAuthority] = useState('')
  const [area, setArea] = useState('')
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5])
  const [startTime, setStartTime] = useState('06:00')
  const [endTime, setEndTime] = useState('10:00')
  const [plates, setPlates] = useState('')
  const [error, setError] = useState<string | null>(null)

  const toggleDay = (d: number) =>
    setWeekdays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()))

  async function save() {
    if (!authority.trim() || !area.trim()) {
      setError('A rule needs the authority it comes from and the area it covers.')
      return
    }
    if (weekdays.length === 0) {
      setError('Pick at least one day, or the rule can never apply.')
      return
    }
    await repos.truckBanRules.add({
      authority: authority.trim(),
      area: area.trim(),
      weekdays,
      startTime,
      endTime,
      // Digits only, deduplicated. A blank field means every plate.
      plateEndsWith: [...new Set(plates.replace(/[^0-9]/g, '').split(''))],
      active: true,
    })
    onDone()
  }

  return (
    <Dialog
      open={open}
      title="Add ban rule"
      width={560}
      onClose={onDone}
      footer={
        <>
          <PrimaryButton onClick={save}>Add rule</PrimaryButton>
          <GhostButton onClick={onDone}>Cancel</GhostButton>
          {error && <span className="ml-auto font-meta text-[12px] font-semibold text-redtext">{error}</span>}
        </>
      }
    >
      <div className="grid grid-cols-2 gap-x-4 gap-y-[14px]">
        <Field label="Authority">
          <Input value={authority} placeholder="e.g. MMDA" onChange={(e) => setAuthority(e.target.value)} />
        </Field>
        <Field label="Area">
          <Input value={area} placeholder="e.g. EDSA" onChange={(e) => setArea(e.target.value)} />
        </Field>
        <Field label="From">
          <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
        </Field>
        <Field label="To" hint="A window may run past midnight.">
          <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
        </Field>
        <Field label="Plates ending in" span2 hint="Leave blank for a blanket ban on every truck.">
          <Input value={plates} placeholder="e.g. 1, 2" onChange={(e) => setPlates(e.target.value)} />
        </Field>
        <Field label="Days" span2>
          <span className="flex flex-wrap gap-[6px]">
            {WEEKDAYS.map((d, i) => {
              const on = weekdays.includes(i)
              return (
                <button
                  key={d}
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  onClick={() => toggleDay(i)}
                  className={`cursor-pointer rounded-[6px] border px-[10px] py-[5px] font-meta text-[12px] transition-colors ${
                    on ? 'border-ink bg-ink font-semibold text-white' : 'border-inputline bg-white text-sec hover:border-ink hover:text-ink'
                  }`}
                >
                  {d}
                </button>
              )
            })}
          </span>
        </Field>
      </div>
    </Dialog>
  )
}


/**
 * The regulations the app applies on its own, with a switch each.
 *
 * A dialog behind a gear rather than a card on the page: these are set once
 * and then left alone, and a card of three paragraphs above the schedule was
 * the least-read thing on the page taking the most room. Drawn as facts with
 * a date, because that is what they are: the MMDA changes these by resolution,
 * and a schedule shown without saying when it was last checked would read as
 * more certain than it is. Switches save as they are flipped.
 */
function Regulations({ open, onClose, settings, onToggle, onFlag }: {
  open: boolean
  onClose: () => void
  settings: NumberCodingSettings
  onToggle: (key: PresetKey, on: boolean) => void
  onFlag: (key: 'fuelTankersExempt' | 'overloadCheck' | 'tollClassCheck', on: boolean) => void
}) {
  const exempt = settings.fuelTankersExempt
  const stale = fuelExemptionStale()

  return (
    <Dialog
      open={open}
      title="Regulations"
      subtitle={`Checked on every trip · schedules as of ${fmtDate(CODING_RULES_AS_OF)}`}
      onClose={onClose}
      width={640}
      footer={<PrimaryButton onClick={onClose}>Done</PrimaryButton>}
    >
      <div className="-mx-5 -my-[18px]">
        {/* The exemption first, because for a fuel hauler it decides whether
            the schedules below apply at all. */}
        <RegRow
          on={exempt}
          onChange={(v) => onFlag('fuelTankersExempt', v)}
          title={FUEL_EXEMPTION.title}
          tone={stale ? 'warn' : 'good'}
          chips={[`since ${fmtDate(FUEL_EXEMPTION.since)}`, stale ? `re-check overdue` : `re-check by ${fmtDate(FUEL_EXEMPTION.recheckBy)}`]}
          note={exempt ? 'While on, no coding or truck-ban schedule is applied to any trip.' : undefined}
          details={[
            ['Source', FUEL_EXEMPTION.source],
            ['Covers', 'Number coding and every truck ban below, for the whole fleet.'],
            ['End date', 'None published. Confirm with the MMDA that it still stands by the re-check date, and switch this off the day it is revoked.'],
          ]}
        />

        <RegHeading>Number coding</RegHeading>
        {PRESETS.filter((p) => p.kind === 'coding').map((p) => (
          <PresetRow key={p.key} preset={p} on={isPresetOn(settings, p.key)} muted={exempt} onChange={(v) => onToggle(p.key, v)} />
        ))}

        <RegHeading>Truck bans</RegHeading>
        {PRESETS.filter((p) => p.kind === 'ban').map((p) => (
          <PresetRow key={p.key} preset={p} on={isPresetOn(settings, p.key)} muted={exempt} onChange={(v) => onToggle(p.key, v)} />
        ))}

        <RegHeading>The truck itself</RegHeading>
        <RegRow
          on={settings.overloadCheck}
          onChange={(v) => onFlag('overloadCheck', v)}
          title="Overloading (RA 8794)"
          chips={['empty weight + litres × 0.85', `${MAX_AXLE_LOAD_KG.toLocaleString()} kg per axle`]}
          details={[
            ['What it checks', 'The truck’s empty weight plus the trip’s diesel against the legal gross weight for its axle code. Needs the empty weight and axles under Settings › Trucks.'],
            ['Legal gross weight', AXLE_CONFIGS.map((a) => `${a.label}: ${a.maxGvwKg.toLocaleString()} kg`).join(' · ')],
            ['Source', `RA 8794 and its IRR as revised by the DPWH (2013); figures as of ${fmtDate(VEHICLE_LIMITS_AS_OF)}. Enforced at tollway entries and DPWH weighbridges.`],
          ]}
        />
        <RegRow
          on={settings.tollClassCheck}
          onChange={(v) => onFlag('tollClassCheck', v)}
          title="Tollway class (Skyway)"
          chips={['Class 3 barred from the elevated Skyway', 'checked against the planned route']}
          details={[
            ['What it checks', 'Whether the planned route runs along the Skyway’s elevated sections or Stage 3, which take Class 1 and 2 only, while the truck is Class 3 (the default for a heavy truck). Set the class under Settings › Trucks.'],
            ['Source', TOLL_CLASS_LIMITS[0].source],
          ]}
        />
      </div>
    </Dialog>
  )
}

const RegHeading = ({ children }: { children: string }) => (
  <p className="m-0 border-b border-linesoft bg-paper px-5 py-[6px] font-meta text-[10px] font-semibold uppercase tracking-[.09em] text-mut">{children}</p>
)

/** One preset as a row: the facts as chips, the small print behind a chevron. */
function PresetRow({ preset: p, on, muted, onChange }: { preset: Preset; on: boolean; muted: boolean; onChange: (v: boolean) => void }) {
  const days = p.weekdays.length === 5 ? 'Mon–Fri' : p.weekdays.length === 6 ? 'Mon–Sat' : p.weekdays.map((d) => WEEKDAY_NAMES[d].slice(0, 3)).join(', ')
  const hh = (t: string) => `${Number(t.slice(0, 2))}${t.slice(3) === '00' ? '' : ':' + t.slice(3)}`
  const hours = p.windows.map((w) => `${hh(w.start)}–${hh(w.end)}`).join(' & ')
  const who = p.byPlate ? 'by plate digit' : p.appliesTo === 'heavy' ? `over ${TRUCK_BAN_GVW_KG.toLocaleString()} kg` : p.appliesTo === 'light' ? `≤ ${TRUCK_BAN_GVW_KG.toLocaleString()} kg` : 'all trucks'
  return (
    <RegRow
      on={on}
      muted={muted}
      onChange={onChange}
      title={p.title}
      chips={[days, hours, who, ...(p.zone ? [ZONE_LABELS[p.zone]] : [])]}
      tone={p.caveat ? 'caveat' : undefined}
      details={[
        ['Where', p.area],
        ['Holidays', p.suspendedOnHolidays ? 'Lifted on holidays' : 'Not lifted on holidays'],
        ...(p.zone ? [['Route', `Only fires for a trip whose planned route enters ${ZONE_LABELS[p.zone]}.`] as [string, string]] : []),
        ...(p.caveat ? [['Before switching on', p.caveat] as [string, string]] : []),
        ['Source', p.source],
      ]}
    />
  )
}

/**
 * A rule row: switch, name, a line of chips saying when and to whom, and
 * the small print folded away under a chevron so the list stays scannable.
 */
function RegRow({ on, muted, onChange, title, chips, note, tone, details }: {
  on: boolean
  muted?: boolean
  onChange: (v: boolean) => void
  title: string
  chips: string[]
  note?: string
  tone?: 'good' | 'warn' | 'caveat'
  details: [string, string][]
}) {
  const [openDetails, setOpenDetails] = useState(false)
  const bg = tone === 'good' ? 'bg-tealbadge/40' : tone === 'warn' ? 'bg-amberbadge/40' : ''
  return (
    <div className={`border-b border-linesoft ${bg} ${muted ? 'opacity-55' : ''}`}>
      <div className="flex items-center gap-3 px-5 py-[10px]">
        <Switch checked={on} onChange={onChange} label={`${title} on`} />
        <button
          type="button"
          onClick={() => setOpenDetails((v) => !v)}
          aria-expanded={openDetails}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-[10px] border-0 bg-transparent p-0 text-left"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold">{title}</span>
            <span className="mt-[4px] flex flex-wrap gap-[4px]">
              {chips.map((c) => (
                <span key={c} className="tnum inline-flex items-center rounded-[4px] border border-line bg-white px-[6px] py-[1px] font-meta text-[11px] text-sec">{c}</span>
              ))}
              {tone === 'caveat' && <span className="inline-flex items-center rounded-[4px] bg-amberbadge px-[6px] py-[1px] font-meta text-[11px] font-semibold text-ambertext">read first</span>}
            </span>
            {note && <span className="mt-[4px] block font-meta text-[12px] text-mut">{note}</span>}
          </span>
          <span className="shrink-0 text-mut">{openDetails ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
        </button>
      </div>
      {openDetails && (
        <dl className="m-0 grid grid-cols-[110px_1fr] gap-x-4 gap-y-[5px] border-t border-linesoft bg-paper px-5 py-[10px] font-meta text-[12px]">
          {details.map(([k, v]) => (
            <Fragment key={k}>
              <dt className="text-mut">{k}</dt>
              <dd className="m-0 text-lab">{v}</dd>
            </Fragment>
          ))}
        </dl>
      )}
    </div>
  )
}

/**
 * The week, with each truck under the day its plate is coded.
 *
 * The first version was a list of trucks with a weekday beside each, which
 * answers "when is this truck coded" and not the question a dispatcher has on
 * a Tuesday morning - "which trucks cannot go out before ten today". A column
 * per day answers that at a glance, and today is the column that is lit. The
 * truck ban is by weight, not by plate, so it is one line under the week
 * rather than a word repeated on every row.
 */
function CodingSchedule({ trucks, settings, onSettings }: {
  trucks: { id: string; plateNumber: string; gvwKg?: number }[]
  settings: NumberCodingSettings
  onSettings: () => void
}) {
  const exempt = settings.fuelTankersExempt
  const stale = exempt && fuelExemptionStale()
  const codingOn = !exempt && (isPresetOn(settings, 'mmdaCoding') || isPresetOn(settings, 'makatiCoding'))
  const banOn = !exempt && isPresetOn(settings, 'mmdaTruckBan')
  const applied = exempt ? [] : PRESETS.filter((p) => isPresetOn(settings, p.key))
  const today = new Date().getDay()
  const sorted = [...trucks].sort((a, b) => a.plateNumber.localeCompare(b.plateNumber))
  const byDay = (d: number) => sorted.filter((t) => codingWeekdayFor(t.plateNumber) === d)
  const unreadable = sorted.filter((t) => codingWeekdayFor(t.plateNumber) === null)
  const heavy = sorted.filter(isHeavyTruck)
  const unweighed = sorted.filter((t) => t.gvwKg === undefined || t.gvwKg === null)
  const windows = PRESETS.find((p) => p.key === (isPresetOn(settings, 'makatiCoding') ? 'makatiCoding' : 'mmdaCoding'))!.windows
  const hh = (t: string) => String(Number(t.slice(0, 2)))
  const hours = windows.map((w) => `${hh(w.start)}–${hh(w.end)}`).join(' & ')

  return (
    <Card>
      <div className="flex items-center gap-[10px] border-b border-linesoft px-[14px] py-[8px]">
        <span className="text-[13px] font-semibold">Number coding this week</span>
        {codingOn && <span className="font-meta text-[12px] text-mut">{hours}</span>}
        <button
          type="button"
          onClick={onSettings}
          aria-label="Regulation settings"
          title={exempt ? 'Fleet exempt under the MMC fuel resolution' : applied.length === 0 ? 'No regulations applied' : `Applied: ${applied.map((p) => p.title).join(', ')}`}
          className="ml-auto inline-flex h-[26px] w-[26px] shrink-0 cursor-pointer items-center justify-center rounded-[6px] border-0 bg-transparent text-mut transition-colors hover:bg-fill2 hover:text-ink"
        >
          <Settings2 size={15} strokeWidth={1.8} />
        </button>
      </div>

      {trucks.length === 0 ? (
        <p className="m-0 px-[14px] py-5 text-center text-[13px] text-faint">No trucks recorded.</p>
      ) : exempt ? (
        <div className="px-[14px] py-[14px] text-center">
          <p className="m-0 text-[13px] font-semibold">Fuel tankers are exempt from coding and the truck ban.</p>
          <p className={`m-0 mt-[3px] font-meta text-[12px] ${stale ? 'font-semibold text-ambertext' : 'text-mut'}`}>
            {stale
              ? `The exemption is past its re-check date - confirm it still stands under Regulations.`
              : `${FUEL_EXEMPTION.source}. Re-check by ${fmtDate(FUEL_EXEMPTION.recheckBy)}.`}
          </p>
        </div>
      ) : !codingOn ? (
        <p className="m-0 px-[14px] py-5 text-center text-[13px] text-faint">Number coding is switched off.</p>
      ) : (
        <div className="grid grid-cols-5 divide-x divide-linesoft">
          {[1, 2, 3, 4, 5].map((d) => {
            const isToday = d === today
            const plates = byDay(d)
            return (
              <div key={d} className={`min-w-0 px-[12px] pb-[12px] pt-[10px] ${isToday ? 'bg-paper' : ''}`}>
                <div className="flex items-baseline gap-[6px]">
                  <span className={`text-[13px] font-semibold ${isToday ? 'text-ink' : 'text-lab'}`}>
                    {WEEKDAY_NAMES[d]}
                  </span>
                  <span className="tnum font-meta text-[12px] text-mut">{CODING_DIGITS[d].join(' · ')}</span>
                  {isToday && (
                    <span className="ml-auto rounded-[4px] bg-ink px-[6px] py-[1px] font-meta text-[10px] font-semibold uppercase tracking-[.08em] text-white">
                      Today
                    </span>
                  )}
                </div>
                <div className="mt-[8px] flex flex-col gap-[4px]">
                  {plates.length === 0 && <span className="font-meta text-[12px] text-faint">No trucks</span>}
                  {plates.map((t) => (
                    <span
                      key={t.id}
                      className={`tnum inline-flex w-fit items-center rounded-[6px] border px-[8px] py-[3px] text-[13px] font-semibold ${
                        isToday ? 'border-redf/40 bg-redbadge text-redtext' : 'border-line bg-white text-ink'
                      }`}
                    >
                      {t.plateNumber}
                    </span>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* The weight-based half, said once and briefly: what, when, how many.
          The plates behind each count are a hover away, not a sentence. */}
      {(banOn || unreadable.length > 0) && trucks.length > 0 && (
        <div className="flex flex-wrap items-center gap-[10px] border-t border-linesoft bg-paper px-[14px] py-[8px] font-meta text-[12px] text-mut">
          {banOn && (
            <span title={`Trucks over ${TRUCK_BAN_GVW_KG.toLocaleString()} kg GVW: ${heavy.map((t) => t.plateNumber).join(', ') || 'none'}`}>
              <span className="font-semibold text-lab">Truck ban</span> Mon–Sat 6–10 & 17–22 ·{' '}
              <span className="tnum">{heavy.length === trucks.length ? 'whole fleet' : `${heavy.length} of ${trucks.length} trucks`}</span>
            </span>
          )}
          {banOn && unweighed.length > 0 && (
            <span
              className="tnum inline-flex cursor-help items-center rounded-[4px] bg-amberbadge px-[6px] py-[2px] text-[11px] font-semibold text-ambertext"
              title={`No GVW entered, so treated as over the limit: ${unweighed.map((t) => t.plateNumber).join(', ')}. Enter it under Settings › Trucks.`}
            >
              {unweighed.length} without GVW
            </span>
          )}
          {unreadable.length > 0 && (
            <span
              className="tnum inline-flex cursor-help items-center rounded-[4px] bg-fill2 px-[6px] py-[2px] text-[11px] font-semibold text-sec"
              title={`No digit to read: ${unreadable.map((t) => t.plateNumber).join(', ')}`}
            >
              {unreadable.length} no digit
            </span>
          )}
        </div>
      )}
    </Card>
  )
}
