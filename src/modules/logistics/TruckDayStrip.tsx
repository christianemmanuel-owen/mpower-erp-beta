import { useLayoutEffect, useRef, useState } from 'react'
import { TRIP_BLOCK_HOURS, clashesWith, fmtHour, truckBookings } from '../../lib/logistics'
import type { Delivery } from '../../data/types'

/**
 * One truck's day as a strip: what it is already booked for, and where the
 * trip being edited would land. The whole day, midnight to midnight, the
 * same clock as the By-truck board: a tanker that rolls at 4am or comes
 * back at 11pm is drawn, not pinned to an edge.
 *
 * Clicking the strip sets the trip's time to that point, snapped to the
 * half hour - a quicker way to find a gap than typing times until the
 * clash warning goes away.
 *
 * Trips that overlap, or sit so close that their labels would collide, go
 * on separate rows - the way a calendar stacks clashing events - so every
 * bar and every label stays readable and to scale.
 */
const DAY_START = 0
const DAY_END = 24
const SPAN = DAY_END - DAY_START
const TICKS = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22]
const hourLabel = (h: number) => (h === 0 ? '12am' : h === 12 ? '12pm' : h > 12 ? `${h - 12}pm` : `${h}am`)
const pct = (h: number) => `${((Math.min(Math.max(h, DAY_START), DAY_END) - DAY_START) / SPAN) * 100}%`
const LANE_H = 30
const LABEL_MAX = 220
/** Roughly what the label's text takes up, in pixels, at 11px meta. */
const labelPx = (text: string) => Math.min(LABEL_MAX, text.length * 6.3 + 6)

interface Item { key: string; start: number; end: number; label: string; note?: string; tone: 'booked' | 'this' | 'clash'; title?: string; ariaLabel?: string }

/**
 * First-fit lanes: each item takes the first row where nothing it would
 * touch - bar or label - is already drawn. `pxPerHour` turns label widths
 * into hours so text collisions count too.
 */
function packLanes(items: Item[], pxPerHour: number): number[] {
  const order = [...items.keys()].sort((a, b) => items[a].start - items[b].start)
  const lanes: { from: number; to: number }[][] = []
  const out = new Array<number>(items.length).fill(0)
  for (const i of order) {
    const it = items[i]
    const labelHours = pxPerHour > 0 ? labelPx(`${it.label} ${it.note ?? ''}`) / pxPerHour : 0
    const late = it.start > DAY_START + SPAN * 0.7
    const span = late
      ? { from: Math.min(it.start, it.end - labelHours), to: it.end }
      : { from: it.start, to: Math.max(it.end, it.start + labelHours) }
    let lane = lanes.findIndex((l) => l.every((o) => span.to + 0.1 <= o.from || span.from >= o.to + 0.1))
    if (lane === -1) { lane = lanes.length; lanes.push([]) }
    lanes[lane].push(span)
    out[i] = lane
  }
  return out
}

export default function TruckDayStrip({ deliveries, truckId, plate, day, tripId, start, hours = TRIP_BLOCK_HOURS, bans = [], inBan = false, rulesOff, onPick }: {
  deliveries: Delivery[]
  truckId: string
  plate: string
  day: string
  /** The trip being edited, left out of the bookings. */
  tripId?: string
  /** Its proposed start, in hours, or null when no time is typed yet. */
  start: number | null
  /** How long this trip takes - the width of its block. */
  hours?: number
  /** Ban windows in force for this truck that day, "HH:MM" to "HH:MM",
   *  shaded on the strip so the clear hours are visible at a glance. */
  bans?: { start: string; end: string; label: string }[]
  /** Why nothing is shaded: the coding and truck-ban schedules are switched
   *  off for the fleet. Said here, where the dispatcher looks for them,
   *  rather than left as a quiet strip that reads as "all clear". */
  rulesOff?: string
  /** The trip as drawn runs into one of those windows: its bar goes red. */
  inBan?: boolean
  onPick: (time: string) => void
}) {
  const toH = (t: string) => { const [h, m] = t.split(':').map(Number); return h + m / 60 }
  // An overnight window is two shaded pieces.
  const shade = bans.flatMap((b) => {
    const f = toH(b.start)
    const t = toH(b.end)
    return f <= t ? [{ ...b, from: f, to: t }] : [{ ...b, from: f, to: 24 }, { ...b, from: 0, to: t }]
  }).filter((b) => b.to > DAY_START && b.from < DAY_END)
  const bookings = truckBookings(deliveries, truckId, day, tripId)
  const clash = start === null ? [] : clashesWith(start, bookings, hours)

  // The strip's width, for judging whether two labels would run into each other.
  const strip = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = strip.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const items: Item[] = [
    ...(start === null ? [] : [{
      key: '__this', start, end: start + hours, tone: clash.length > 0 || inBan ? 'clash' : 'this',
      label: `${fmtHour(start)}–${fmtHour(start + hours)}`, note: 'this trip',
      ariaLabel: `This trip ${fmtHour(start)} to ${fmtHour(start + hours)}`,
    } as Item]),
    ...bookings.map((b): Item => ({
      key: b.delivery.id, start: b.start, end: b.end, tone: 'booked',
      label: `${fmtHour(b.start)}–${fmtHour(b.end)}`, note: b.delivery.deliveryAddress,
      title: `${fmtHour(b.start)}–${fmtHour(b.end)} · ${b.delivery.deliveryAddress}`,
    })),
  ]
  const lanes = packLanes(items, width / SPAN)
  const rows = Math.max(1, ...lanes.map((l) => l + 1))

  const pick = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const h = DAY_START + ((e.clientX - r.left) / r.width) * SPAN
    onPick(fmtHour(Math.round(h * 2) / 2))
  }

  return (
    <div className="col-span-2 rounded-[10px] border border-line bg-paper p-[10px]" role="group" aria-label={`${plate} on ${day}`}>
      <div className="mb-[6px] flex items-baseline gap-[8px]">
        <span className="font-meta text-[11px] font-semibold uppercase tracking-[.08em] text-mut">{plate} that day</span>
        <span className="font-meta text-[12px] text-mut">
          {bookings.length === 0 ? 'nothing else booked'
            : `booked ${bookings.map((b) => fmtHour(b.start)).join(', ')}`}
        </span>
        {bans.length > 0 && (
          <span className="font-meta text-[12px] text-redtext">
            · {bans.map((b) => `${b.label.toLowerCase()} ${b.start}–${b.end}`).join(' · ')}
          </span>
        )}
        {rulesOff && bans.length === 0 && (
          <span className="font-meta text-[12px] text-ambertext">· {rulesOff}</span>
        )}
        {clash.length > 0 && (
          <span className="ml-auto font-meta text-[12px] font-semibold text-redtext">
            Overlaps the {fmtHour(clash[0].start)} trip
          </span>
        )}
      </div>
      <div
        ref={strip}
        className="relative cursor-crosshair overflow-hidden rounded-[8px] border border-linesoft bg-white"
        style={{ height: 8 + rows * LANE_H + 16 }}
        onClick={pick}
        title="Click to set the time"
      >
        {/* A ban window is a quiet tint with a red edge along the top, and no
            text inside - the words go in the header line, where they cannot
            run into a trip's label. */}
        {shade.map((b, i) => (
          <span
            key={i}
            aria-hidden
            title={`${b.label} ${b.start}–${b.end}`}
            className="absolute inset-y-0 bg-redbadge/70"
            style={{ left: pct(b.from), width: `calc(${((Math.min(b.to, DAY_END) - Math.max(b.from, DAY_START)) / SPAN) * 100}%)` }}
          >
            <span className="absolute inset-x-0 top-0 h-[3px] bg-redbright/70" />
          </span>
        ))}
        {TICKS.map((h) => (
          <span key={h} aria-hidden className="absolute inset-y-0 border-l border-dashed border-linesoft" style={{ left: pct(h) }}>
            <span className="absolute bottom-[2px] left-[3px] font-meta text-[9.5px] text-faint">{hourLabel(h)}</span>
          </span>
        ))}
        {/* Bars are to scale - their edges are the times. The label sits on a
            row of its own above the bar, so a short trip is still a thin bar
            at the right place rather than a block widened to fit its text. */}
        {items.map(({ key, ...bar }, i) => <Bar key={key} {...bar} lane={lanes[i]} />)}
      </div>
    </div>
  )
}

const TONE = {
  booked: { bar: 'bg-line', text: 'text-sec' },
  this: { bar: 'bg-teal', text: 'text-tealtext' },
  clash: { bar: 'bg-redf', text: 'text-redtext' },
} as const

function Bar({ start, end, tone, label, note, title, ariaLabel, lane }: Omit<Item, 'key'> & { lane: number }) {
  const t = TONE[tone]
  const top = 8 + lane * LANE_H
  const width = `calc(${((Math.min(end, DAY_END) - Math.max(start, DAY_START)) / SPAN) * 100}% - 1px)`
  // A trip that starts late in the day would push its label past the edge;
  // hang it to the left of the bar's end instead.
  const late = start > DAY_START + SPAN * 0.7
  return (
    <span className="absolute" style={{ left: pct(start), width, top, height: LANE_H }} title={title} aria-label={ariaLabel}>
      <span
        className={`absolute top-0 block w-max overflow-hidden text-ellipsis whitespace-nowrap font-meta text-[11px] ${t.text}`}
        style={{ maxWidth: LABEL_MAX, ...(late ? { right: 0 } : { left: 0 }) }}
      >
        <span className="tnum font-semibold">{label}</span>
        {note && <span className="ml-[5px]">{note}</span>}
      </span>
      <span className={`absolute left-0 top-[18px] h-[8px] w-full rounded-[3px] ${t.bar}`} />
      <span className={`absolute left-0 top-[16px] h-[12px] w-[2px] rounded-[1px] ${t.bar}`} />
    </span>
  )
}
