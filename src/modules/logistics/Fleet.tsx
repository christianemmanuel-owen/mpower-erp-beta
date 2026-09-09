import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import {
  Card, DataTable, Dialog, Field, GhostButton, Input, MiniDark, PrimaryButton, Select, td,
} from '../../components/ui'
import { useTables } from '../../lib/data'
import { repos } from '../../data/repo'
import { todayISO, fmtCurrency, fmtDate } from '../../lib/format'
import { bansFor, daysUntil, maintenanceCovers } from '../../lib/logistics'
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
                  <button
                    type="button"
                    title="Remove this booking"
                    onClick={() => repos.vehicleMaintenance.remove(m.id)}
                    className="cursor-pointer text-mut hover:text-redtext"
                  >
                    <Trash2 size={13} />
                  </button>
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
  const data = useTables(['truckBanRules', 'trucks', 'deliveries'] as const)
  const [adding, setAdding] = useState(false)

  if (!data) return <Card className="p-6"><p className="m-0 text-[13px] text-faint">Loading…</p></Card>
  const { truckBanRules, trucks, deliveries } = data

  /** Open trips whose scheduled moment lands inside a rule. This is the whole
   * point of keeping the table: a rule nobody checks against a trip is a
   * document, not a control. */
  const clashes = deliveries
    .filter((d) => d.status !== 'delivered' && d.status !== 'failed' && d.truckId)
    .map((d) => {
      const truck = trucks.find((t) => t.id === d.truckId)
      const hits = truck ? bansFor(truckBanRules, truck.plateNumber, d.scheduleDate) : []
      return { delivery: d, truck, hits }
    })
    .filter((c) => c.hits.length > 0)

  return (
    <div className="flex flex-col gap-4">
      {clashes.length > 0 && (
        <Card>
          <div className="flex items-center gap-[10px] border-b border-linesoft px-[14px] py-[10px]">
            <span className="text-[13px] font-semibold text-redtext">Trips scheduled into a ban</span>
            <span className="ml-auto font-meta text-[12px] text-mut">{clashes.length}</span>
          </div>
          {clashes.map(({ delivery, truck, hits }) => (
            <div key={delivery.id} className="flex items-center gap-3 border-b border-linesoft px-[14px] py-[9px] last:border-0">
              <span className="w-[104px] shrink-0 text-[13px] font-semibold">{truck?.plateNumber}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px]">{delivery.deliveryAddress}</span>
                <span className="mt-[1px] block font-meta text-[12px] text-mut">
                  {hits.map((h) => `${h.authority} · ${h.area}`).join(' · ')}
                </span>
              </span>
              <span className="font-meta text-[12px] font-semibold text-redtext">
                {fmtDate(delivery.scheduleDate)}
              </span>
            </div>
          ))}
        </Card>
      )}

      <AddBanRule open={adding} onDone={() => setAdding(false)} />

      <Card>
        <div className="flex items-center gap-[10px] border-b border-linesoft px-[14px] py-[10px]">
          <span className="text-[13px] font-semibold">Ban and coding rules</span>
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
          empty="No rules recorded. Nothing here can warn you about a trip until the Client's ban table is entered."
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
                <button
                  type="button"
                  title="Remove this rule"
                  onClick={() => repos.truckBanRules.remove(r.id)}
                  className="cursor-pointer text-mut hover:text-redtext"
                >
                  <Trash2 size={13} />
                </button>
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
