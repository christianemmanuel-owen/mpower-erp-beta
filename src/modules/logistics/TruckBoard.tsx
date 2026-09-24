import { useState, useRef } from 'react'
import { CalendarDays, Check, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { Avatar } from '../../components/ui'
import { addDaysISO, fmtDate, fmtLiters, todayISO } from '../../lib/format'
import { MOVEMENT_LABELS, fmtHour, tripHours, tripStartHour } from '../../lib/logistics'
import type { Delivery, DeliveryStatus, Truck } from '../../data/types'

/**
 * The day's dispatch as a schedule: trucks down the left, hours across, each
 * trip a block at its scheduled time - the shape shift-scheduling tools use
 * (Fresha, 7shifts), because a dispatcher's question is "who is where, when".
 *
 * The top row is the tray: every open trip that has no truck yet, whatever
 * day it was wanted for, so the work still to be booked is on the board
 * rather than on some other day the dispatcher is not looking at. Drag one
 * onto a truck's row and it is booked on that truck, on the shown day, at
 * the hour it was dropped - and its drawer opens, because a trip booked from
 * a tray still wants a route, a crew and a check against the coding bans,
 * and the drawer is where those are asked for. A block already on the board
 * dragged to another row or another hour just moves. Dropped on the tray it
 * is unbooked. On the road it carries a tick (delivered) and a cross
 * (failed); once concluded it goes green or red and fades. It is the same
 * record as the status board, so everything else follows. Native HTML5 drag
 * and drop; on a phone the drawer's truck picker does the same job.
 */
export interface TruckBoardProps {
  trucks: Truck[]
  deliveries: Delivery[]
  customerOf: (d: Delivery) => string | undefined
  driverOf: (d: Delivery) => string | undefined
  litersOf: (d: Delivery) => number | undefined
  /** Trucks in the workshop on the shown day, by id. */
  workshopOn: (dayISO: string) => Set<string>
  /** Book, move or unbook a trip: the truck it lands on (null unbooks), and
   *  when a drop on a truck's row sets it, the day and hour it landed at. */
  onAssign: (d: Delivery, patch: BoardPatch) => void | Promise<unknown>
  onAdvance: (d: Delivery, next: DeliveryStatus) => void
  onOpen: (d: Delivery) => void
}

export interface BoardPatch {
  truckId: string | null
  scheduleDate?: string
  scheduleTime?: string
}

/** A drop's hour, from where the pointer was over the row, to the half hour. */
export function dropHour(x: number, left: number, width: number): number | null {
  if (!(width > 0)) return null
  const h = DAY_START + ((x - left) / width) * (DAY_END - DAY_START)
  return Math.min(Math.max(Math.round(h * 2) / 2, DAY_START), DAY_END - 0.5)
}

const OPEN: DeliveryStatus[] = ['scheduled', 'loading', 'in_transit']
/** The whole day, midnight to midnight: tankers roll before dawn and come
 *  back late, and a clock that started at 5am pinned those to the edge. */
const DAY_START = 0
const DAY_END = 24
const HOURS = Array.from({ length: DAY_END - DAY_START }, (_, i) => DAY_START + i)
/** Blocks have no end time on the record; two hours is a fair run and keeps them readable. */

const hourLabel = (h: number) => (h === 0 ? '12am' : h === 12 ? '12pm' : h > 12 ? `${h - 12}pm` : `${h}am`)

export default function TruckBoard({ trucks, deliveries, customerOf, driverOf, litersOf, workshopOn, onAssign, onAdvance, onOpen }: TruckBoardProps) {
  const [day, setDay] = useState(todayISO())
  const dateInput = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const today = todayISO()
  const workshop = workshopOn(day)

  const onDay = deliveries
    .filter((d) => d.scheduleDate.slice(0, 10) === day)
    .sort((a, b) => a.scheduleDate.localeCompare(b.scheduleDate))
  // The tray: no truck yet, still open, any day - oldest wanted date first.
  const tray = deliveries
    .filter((d) => !d.truckId && OPEN.includes(d.status))
    .sort((a, b) => a.scheduleDate.localeCompare(b.scheduleDate))
  const byTruck = new Map(trucks.map((t) => [t.id, onDay.filter((d) => d.truckId === t.id)]))
  const openCount = onDay.filter((d) => OPEN.includes(d.status)).length

  const dropOn = (truckId: string | undefined) => async (e: React.DragEvent) => {
    e.preventDefault()
    const id = e.dataTransfer.getData('text/trip') || dragging
    setOver(null)
    setDragging(null)
    const d = deliveries.find((x) => x.id === id)
    if (!d) return
    if (!truckId) {
      if (d.truckId) onAssign(d, { truckId: null })
      return
    }
    // Where along the row it landed is when it leaves. Off the board (a
    // test, a keyboard drop) the time stays as it was.
    const lane = (e.currentTarget as HTMLElement).querySelector<HTMLElement>('[role=list]')
    const r = lane?.getBoundingClientRect()
    const h = r ? dropHour(e.clientX, r.left, r.width) : null
    // The day is the first ten characters of scheduleDate, everywhere in
    // the app (the drawer's date field stores UTC midnight; every board and
    // list filters on the slice). So the day goes into those characters as
    // is - not through a local Date, which east of Greenwich puts an early
    // hour on the day before - and the hour goes into scheduleTime.
    const patch: BoardPatch = { truckId }
    if (h !== null) {
      patch.scheduleDate = `${day}T00:00:00.000Z`
      patch.scheduleTime = fmtHour(h)
    } else if (d.scheduleDate.slice(0, 10) !== day) {
      patch.scheduleDate = `${day}${d.scheduleDate.slice(10)}`
    }
    const fromTray = !d.truckId
    const moved = patch.scheduleDate !== undefined && patch.scheduleDate !== d.scheduleDate
    if (!fromTray && d.truckId === truckId && !moved) return
    await onAssign(d, patch)
    // Booked from the tray: the drawer opens on what the trip still needs.
    if (fromTray) onOpen({ ...d, ...patch, truckId })
  }
  const allowDrop = (key: string) => (e: React.DragEvent) => {
    if (!dragging) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (over !== key) setOver(key)
  }

  /** Left edge and width as a share of the day, clamped into the drawn hours. */
  const place = (d: Delivery) => {
    const span = DAY_END - DAY_START
    const start = Math.min(Math.max(tripStartHour(d), DAY_START), DAY_END - 0.5)
    const left = ((start - DAY_START) / span) * 100
    const width = Math.min((tripHours(d) / span) * 100, 100 - left)
    return { left: `${left}%`, width: `${width}%` }
  }

  const block = (d: Delivery, lane: number) => {
    const concluded = d.status === 'delivered' || d.status === 'failed'
    const draggable = OPEN.includes(d.status)
    const late = d.scheduleDate.slice(0, 10) < today && !concluded
    const tone = d.status === 'delivered' ? 'border-greentext/30 bg-greenbadge text-greentext opacity-60'
      : d.status === 'failed' ? 'border-redf/30 bg-redbadge text-redtext opacity-60'
      : d.status === 'in_transit' ? 'border-tealbright bg-tealbadge text-ink'
      : d.status === 'loading' ? 'border-amberline bg-amberbadge text-ink'
      : 'border-inputline bg-white text-ink'
    const name = customerOf(d) ?? MOVEMENT_LABELS[d.movementType ?? 'delivery_to_client']
    return (
      <div
        key={d.id}
        draggable={draggable}
        onDragStart={(e) => { e.dataTransfer.setData('text/trip', d.id); e.dataTransfer.effectAllowed = 'move'; setDragging(d.id) }}
        onDragEnd={() => { setDragging(null); setOver(null) }}
        role="listitem"
        aria-label={`${name}, ${fmtHour(tripStartHour(d))}, ${d.status.replace('_', ' ')}`}
        style={{ ...place(d), top: 8 + lane * 56 }}
        className={`group absolute flex h-[48px] items-center gap-[8px] overflow-hidden rounded-[8px] border px-[10px] transition-[opacity,box-shadow] ${tone} ${
          draggable ? 'cursor-grab hover:shadow-[0_2px_8px_rgba(20,24,27,.10)] active:cursor-grabbing' : ''
        } ${dragging === d.id ? 'opacity-40' : ''}`}
      >
        <button type="button" onClick={() => onOpen(d)} className="min-w-0 flex-1 cursor-pointer border-0 bg-transparent p-0 text-left">
          <span className={`block truncate text-[12px] font-semibold leading-[1.25] ${concluded ? 'line-through' : ''}`}>{name}</span>
          <span className="tnum block truncate font-meta text-[11px] leading-[1.25] text-mut">
            {fmtHour(tripStartHour(d))}{litersOf(d) ? ` · ${fmtLiters(litersOf(d)!)}` : ''}{late ? ' · late' : ''}
          </span>
        </button>
        {d.status === 'delivered' && <Check size={14} strokeWidth={2.6} className="shrink-0" aria-label="Delivered" />}
        {d.status === 'failed' && <X size={14} strokeWidth={2.6} className="shrink-0" aria-label="Failed" />}
        {d.status === 'in_transit' && (
          <span className="flex shrink-0 gap-[4px]">
            <button
              type="button"
              onClick={() => onAdvance(d, 'delivered')}
              aria-label={`Mark ${name} delivered`}
              title="Delivered"
              className="flex h-[24px] w-[24px] cursor-pointer items-center justify-center rounded-[6px] border-0 bg-ink text-white hover:bg-inkhov"
            >
              <Check size={13} strokeWidth={2.8} />
            </button>
            <button
              type="button"
              onClick={() => onAdvance(d, 'failed')}
              aria-label={`Mark ${name} failed`}
              title="Failed"
              className="flex h-[24px] w-[24px] cursor-pointer items-center justify-center rounded-[6px] border border-line bg-white text-mut hover:border-redf hover:text-redtext"
            >
              <X size={13} strokeWidth={2.6} />
            </button>
          </span>
        )}
      </div>
    )
  }

  /** Overlapping blocks stack into lanes so none hides another. */
  const lanes = (items: Delivery[]) => {
    const ends: number[] = []
    return items.map((d) => {
      const start = tripStartHour(d)
      let lane = ends.findIndex((e) => e <= start)
      if (lane === -1) { lane = ends.length; ends.push(0) }
      ends[lane] = start + tripHours(d)
      return { d, lane }
    })
  }

  /** A tray chip: the trip, how much, and the day it was wanted for. */
  const chip = (d: Delivery) => {
    const name = customerOf(d) ?? MOVEMENT_LABELS[d.movementType ?? 'delivery_to_client']
    const wanted = d.scheduleDate.slice(0, 10)
    const when = wanted < today ? { text: `wanted ${fmtDate(d.scheduleDate)} · late`, cls: 'text-redtext' }
      : wanted === day ? { text: 'wanted this day', cls: 'text-mut' }
      : { text: `wanted ${fmtDate(d.scheduleDate)}`, cls: 'text-ambertext' }
    return (
      <div
        key={d.id}
        draggable
        onDragStart={(e) => { e.dataTransfer.setData('text/trip', d.id); e.dataTransfer.effectAllowed = 'move'; setDragging(d.id) }}
        onDragEnd={() => { setDragging(null); setOver(null) }}
        role="listitem"
        aria-label={`${name}, ${when.text}, to book`}
        className={`group flex h-[44px] cursor-grab items-center gap-[8px] rounded-[8px] border border-dashed border-inputline bg-white px-[10px] transition-[opacity,box-shadow] hover:border-ink hover:shadow-[0_2px_8px_rgba(20,24,27,.10)] active:cursor-grabbing ${dragging === d.id ? 'opacity-40' : ''}`}
      >
        <button type="button" onClick={() => onOpen(d)} className="min-w-0 cursor-pointer border-0 bg-transparent p-0 text-left">
          <span className="block truncate text-[12px] font-semibold leading-[1.25] text-ink">{name}</span>
          <span className={`tnum block truncate font-meta text-[11px] leading-[1.25] ${when.cls}`}>
            {litersOf(d) ? `${fmtLiters(litersOf(d)!)} · ` : ''}{when.text}
          </span>
        </button>
      </div>
    )
  }

  const row = (key: string, head: React.ReactNode, items: Delivery[], truckId: string | undefined) => {
    const placed = lanes(items)
    const laneCount = Math.max(1, ...placed.map((p) => p.lane + 1))
    return (
      <div
        key={key}
        onDragOver={allowDrop(key)}
        onDragLeave={() => over === key && setOver(null)}
        onDrop={dropOn(truckId)}
        className={`grid grid-cols-[220px_minmax(0,1fr)] border-b border-linesoft last:border-b-0 transition-colors ${over === key ? 'bg-tealbadge/50' : ''}`}
      >
        <div className="flex items-center border-r border-line px-[16px] py-[12px]">{head}</div>
        <div
          role="list"
          aria-label={`Trips for ${trucks.find((t) => t.id === truckId)?.plateNumber}`}
          className="relative"
          style={{ height: 16 + laneCount * 56 }}
        >
          {/* Hour lines. */}
          {HOURS.map((h, i) => i > 0 && h % 2 === 0 && (
            <span key={h} aria-hidden className="absolute inset-y-0 w-px bg-linesoft" style={{ left: `${(i / HOURS.length) * 100}%` }} />
          ))}
          {day === today && (() => {
            const now = new Date()
            const h = now.getHours() + now.getMinutes() / 60
            if (h < DAY_START || h > DAY_END) return null
            return <span aria-hidden className="absolute inset-y-0 w-[2px] bg-redf/70" style={{ left: `${((h - DAY_START) / (DAY_END - DAY_START)) * 100}%` }} />
          })()}
          {placed.map(({ d, lane }) => block(d, lane))}
        </div>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-[10px] border border-line bg-white">
      {/* Day picker and legend. */}
      <div className="flex flex-wrap items-center gap-[12px] border-b border-line px-[16px] py-[10px]">
        <span className="flex items-center gap-[2px]">
          <button type="button" onClick={() => setDay(addDaysISO(day, -1))} aria-label="Previous day" className="flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-[6px] border border-line bg-white text-sec hover:bg-fill2"><ChevronLeft size={14} /></button>
          <button type="button" onClick={() => setDay(today)} className={`h-[26px] cursor-pointer rounded-[6px] border px-[9px] font-meta text-[12px] font-semibold ${day === today ? 'border-ink bg-ink text-white' : 'border-line bg-white text-sec hover:bg-fill2'}`}>Today</button>
          <button type="button" onClick={() => setDay(addDaysISO(day, 1))} aria-label="Next day" className="flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-[6px] border border-line bg-white text-sec hover:bg-fill2"><ChevronRight size={14} /></button>
        </span>
        {/* The date is the picker: click it for the calendar rather than
            stepping a day at a time to reach next month. The native input
            sits invisibly over the label so the browser's own calendar opens. */}
        <button
          type="button"
          onClick={() => {
            const el = dateInput.current
            if (!el) return
            // Chrome only opens the calendar from the input's own icon, and
            // Safari not at all from a click - so ask for it outright.
            try { el.showPicker() } catch { el.focus(); el.click() }
          }}
          className="relative inline-flex h-[26px] cursor-pointer items-center gap-[6px] rounded-[6px] border border-line bg-white px-[9px] text-[13px] font-semibold text-ink hover:bg-fill2"
          title="Pick a day"
        >
          <CalendarDays size={13} className="text-mut" aria-hidden />
          {fmtDate(day)}
          <input
            ref={dateInput}
            type="date"
            aria-label="Day shown"
            value={day}
            onChange={(e) => { if (e.target.value) setDay(e.target.value) }}
            className="pointer-events-none absolute inset-x-0 bottom-0 h-0 w-full opacity-0"
            tabIndex={-1}
          />
        </button>
        <span className="font-meta text-[12px] text-mut">{openCount} open · {onDay.length - openCount} concluded</span>
        <span className="ml-auto flex items-center gap-[12px] font-meta text-[11px] text-mut">
          <span className="inline-flex items-center gap-[4px]"><span className="h-[8px] w-[8px] rounded-[2px] border border-inputline bg-white" />Scheduled</span>
          <span className="inline-flex items-center gap-[4px]"><span className="h-[8px] w-[8px] rounded-[2px] bg-amberbadge border border-amberline" />Loading</span>
          <span className="inline-flex items-center gap-[4px]"><span className="h-[8px] w-[8px] rounded-[2px] bg-tealbadge border border-tealbright" />On the road</span>
          <span className="inline-flex items-center gap-[4px]"><span className="h-[8px] w-[8px] rounded-[2px] bg-greenbadge" />Delivered</span>
          <span className="inline-flex items-center gap-[4px]"><span className="h-[8px] w-[8px] rounded-[2px] bg-redbadge" />Failed</span>
        </span>
      </div>

      {/* Hour ruler. */}
      <div className="grid grid-cols-[220px_minmax(0,1fr)] border-b border-line bg-paper">
        <div className="flex items-center px-[16px] py-[8px] font-meta text-[10px] font-semibold uppercase tracking-[.08em] text-mut">Truck</div>
        <div className="relative h-[32px]">
          {HOURS.map((h, i) => i > 0 && h % 2 === 0 && (
            <span key={h} className="tnum absolute top-[9px] -translate-x-1/2 font-meta text-[11px] text-mut" style={{ left: `${(i / HOURS.length) * 100}%` }}>
              {hourLabel(h)}
            </span>
          ))}
        </div>
      </div>

      {/* The tray. Not on the hour grid - these have no hour yet. */}
      <div
        onDragOver={allowDrop('tray')}
        onDragLeave={() => over === 'tray' && setOver(null)}
        onDrop={dropOn(undefined)}
        className={`grid grid-cols-[220px_minmax(0,1fr)] border-b border-line transition-colors ${over === 'tray' ? 'bg-tealbadge/50' : 'bg-[repeating-linear-gradient(45deg,transparent,transparent_10px,rgba(20,24,27,.025)_10px,rgba(20,24,27,.025)_11px)]'}`}
      >
        <div className="flex items-center border-r border-line px-[16px] py-[12px]">
          <span className="min-w-0">
            <span className="block text-[14px] font-semibold leading-[1.2] text-lab">To book{tray.length > 0 ? ` · ${tray.length}` : ''}</span>
            <span className="mt-[3px] block font-meta text-[11.5px] text-faint">
              {tray.length === 0 ? 'Every open trip has a truck' : 'Drag onto a truck at the hour it leaves'}
            </span>
          </span>
        </div>
        <div role="list" aria-label="Trips to book" className="flex min-h-[60px] flex-wrap items-center gap-[8px] px-[12px] py-[8px]">
          {tray.map(chip)}
        </div>
      </div>

      {trucks.map((t) => {
        const items = byTruck.get(t.id) ?? []
        const out = items.some((d) => d.status === 'in_transit')
        const inShop = workshop.has(t.id)
        const driver = items.map(driverOf).find(Boolean)
        return row(t.id, (
          <span className="flex min-w-0 items-center gap-[10px]">
            <span className={`h-[8px] w-[8px] shrink-0 rounded-full ${inShop ? 'bg-amber' : out ? 'bg-tealbright' : items.length ? 'bg-faint' : 'bg-line'}`} aria-hidden />
            <span className="min-w-0">
              <span className="block truncate text-[14px] font-semibold leading-[1.2]">{t.plateNumber}</span>
              <span className="mt-[3px] block truncate font-meta text-[11.5px] text-mut">
                {inShop ? <span className="font-semibold text-ambertext">In maintenance</span> : fmtLiters(t.capacityLiters)}
                {driver && !inShop && <span className="inline-flex items-center gap-[4px]"><span className="mx-[3px] text-faint">·</span><Avatar name={driver} size={14} />{driver}</span>}
              </span>
              {items.length > 0 && !inShop && (
                <span className="mt-[2px] block font-meta text-[11px] text-faint">{items.length} trip{items.length === 1 ? '' : 's'}</span>
              )}
            </span>
          </span>
        ), items, t.id)
      })}
    </div>
  )
}
