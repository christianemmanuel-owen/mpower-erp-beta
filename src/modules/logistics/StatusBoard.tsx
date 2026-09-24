import { useState } from 'react'
import { ArrowRight, Check, Droplets, Truck as TruckIcon, X } from 'lucide-react'
import { Avatar } from '../../components/ui'
import { fmtDate, fmtLiters, fmtTime, todayISO } from '../../lib/format'
import { MOVEMENT_LABELS, checklistProgress, needsChecklist } from '../../lib/logistics'
import { STAGE_ACTION, receiptSlot, stageOf } from '../../lib/tripStages'
import type { Delivery, DeliveryStatus } from '../../data/types'

/**
 * The pipeline as three working columns and a ledger of what concluded.
 *
 * The old board gave Delivered and Failed the same width as the columns
 * someone actually works in, so a fifth of the screen held cards nobody
 * touches. Now the three live stages take the width and the concluded trips
 * of the week sit in a narrow rail on the right as one-line entries: enough
 * to see how the day went and to reopen one, not enough to compete.
 *
 * Inside a column the cards are grouped by day - Overdue, Today, Tomorrow,
 * then dated - so a dispatcher reads a column top to bottom in the order the
 * work is due. Dragging a card into the next column is the same handoff as
 * its button: the drop calls the one advance the page already has.
 */
const PIPELINE: { status: DeliveryStatus; title: string; dot: string; hint: string }[] = [
  { status: 'scheduled', title: 'Scheduled', dot: 'bg-faint', hint: 'Nothing scheduled' },
  { status: 'loading', title: 'Loading', dot: 'bg-amber', hint: 'No truck loading' },
  { status: 'in_transit', title: 'In transit', dot: 'bg-tealbright', hint: 'No truck on the road' },
]

/** The next step, in one word, for the card footer. The drawer keeps the full label. */
const CARD_ACTION: Partial<Record<DeliveryStatus, string>> = { scheduled: 'Load', loading: 'Dispatch', in_transit: 'Delivered' }

/** Cards rendered per column before the rest becomes a count. */
const PER_COLUMN = 12
const DAY = 86_400_000

export interface StatusBoardProps {
  deliveries: Delivery[]
  customerOf: (d: Delivery) => string | undefined
  driverOf: (d: Delivery) => string | undefined
  plateOf: (d: Delivery) => string | undefined
  litersOf: (d: Delivery) => number | undefined
  onAdvance: (d: Delivery, next: DeliveryStatus) => void
  onOpen: (d: Delivery) => void
}

/** Overdue / Today / Tomorrow / a date - the label a column is split under. */
function dayBucket(day: string, today: string): { key: string; label: string; late: boolean } {
  if (day < today) return { key: '0-late', label: 'Overdue', late: true }
  if (day === today) return { key: '1-today', label: 'Today', late: false }
  const tomorrow = new Date(Date.parse(today) + DAY).toISOString().slice(0, 10)
  if (day === tomorrow) return { key: '2-tomorrow', label: 'Tomorrow', late: false }
  return { key: `3-${day}`, label: fmtDate(day).replace(', 2026', ''), late: false }
}

export default function StatusBoard({ deliveries, customerOf, driverOf, plateOf, litersOf, onAdvance, onOpen }: StatusBoardProps) {
  const today = todayISO()
  const [dragging, setDragging] = useState<Delivery | null>(null)
  const [over, setOver] = useState<DeliveryStatus | null>(null)
  // Columns the user has asked to see in full, and how far back the ledger
  // reaches. Both used to be fixed caps that printed "12 more" with no way to
  // get at them, which on a real book meant most trips were invisible.
  const [expanded, setExpanded] = useState<Set<DeliveryStatus>>(() => new Set())
  const [ledgerDays, setLedgerDays] = useState<7 | 30 | 0>(7)
  const [ledgerShown, setLedgerShown] = useState(20)

  const columns = PIPELINE.map((col, i) => {
    const all = deliveries
      .filter((d) => d.status === col.status)
      .sort((a, b) => a.scheduleDate.localeCompare(b.scheduleDate))
    const liters = all.reduce((sum, d) => sum + (litersOf(d) ?? 0), 0)
    const shown = expanded.has(col.status) ? all : all.slice(0, PER_COLUMN)
    const groups: { key: string; label: string; late: boolean; items: Delivery[] }[] = []
    for (const d of shown) {
      const b = dayBucket(d.scheduleDate.slice(0, 10), today)
      const g = groups.find((x) => x.key === b.key)
      if (g) g.items.push(d)
      else groups.push({ ...b, items: [d] })
    }
    groups.sort((a, b) => a.key.localeCompare(b.key))
    // The stage a card in the previous column moves to when dropped here.
    const accepts = i === 0 ? null : PIPELINE[i - 1].status
    return { ...col, total: all.length, liters, groups, hidden: all.length - shown.length, accepts }
  })

  /**
   * When a trip concluded, for the ledger.
   *
   * The day it was closed, not the day it was booked for. The rail used to
   * filter on the schedule date, so a trip that ran two weeks late and was
   * marked delivered this morning vanished from the board the moment it was
   * closed - it left In transit, and the ledger's seven-day window had already
   * passed its scheduled day. Nobody could find where it went.
   */
  const concludedOn = (d: Delivery) => d.outcome?.completedAt || d.updatedAt || d.scheduleDate
  const cutoff = ledgerDays === 0 ? 0 : Date.now() - ledgerDays * DAY
  const concluded = deliveries
    .filter((d) => (d.status === 'delivered' || d.status === 'failed') && Date.parse(concludedOn(d)) > cutoff)
    .sort((a, b) => concludedOn(b).localeCompare(concludedOn(a)))
  const concludedLiters = concluded.filter((d) => d.status === 'delivered').reduce((s, d) => s + (litersOf(d) ?? 0), 0)

  const canDrop = (target: DeliveryStatus | null) => !!dragging && !!target && dragging.status === target

  return (
    <div className="grid grid-cols-[1fr_1fr_1fr_minmax(190px,0.72fr)] items-start gap-[12px]">
      {columns.map((col) => {
        const hot = canDrop(col.accepts) && over === col.status
        return (
          <section
            key={col.status}
            aria-label={col.title}
            onDragOver={(e) => { if (canDrop(col.accepts)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOver(col.status) } }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null) }}
            onDrop={(e) => {
              e.preventDefault()
              const id = e.dataTransfer.getData('text/trip')
              const d = deliveries.find((x) => x.id === id)
              if (!d || col.accepts !== d.status) return
              setOver(null); setDragging(null)
              onAdvance(d, col.status)
            }}
            className={`rounded-[12px] p-[8px] transition-[box-shadow,background-color] ${
              hot ? 'bg-tealbadge/40 shadow-[inset_0_0_0_2px_var(--color-tealbright)]' : 'bg-fill2/60'
            }`}
          >
            <header className="mb-[6px] flex items-center gap-[7px] px-[4px] pt-[2px]">
              <span className={`h-[8px] w-[8px] rounded-full ${col.dot}`} aria-hidden />
              <p className="m-0 text-[13px] font-semibold">{col.title}</p>
              <span className="tnum rounded-full bg-white px-[7px] py-[1px] font-meta text-[11px] font-semibold text-mut">{col.total}</span>
              {col.liters > 0 && <span className="tnum ml-auto font-meta text-[11px] text-faint">{fmtLiters(col.liters)}</span>}
            </header>

            <div className="flex flex-col gap-[8px]">
              {col.groups.map((g) => (
                <div key={g.key}>
                  <p className={`m-0 mb-[5px] mt-[4px] px-[4px] font-meta text-[10.5px] font-semibold uppercase tracking-[.08em] ${g.late ? 'text-redtext' : 'text-faint'}`}>
                    {g.label}
                    <span className="ml-[5px] font-normal normal-case tracking-normal">{g.items.length}</span>
                  </p>
                  <ul className="m-0 flex list-none flex-col gap-[8px] p-0">
                    {g.items.map((d) => (
                      <TripCard
                        key={d.id}
                        d={d}
                        today={today}
                        customer={customerOf(d)}
                        driver={driverOf(d)}
                        plate={plateOf(d)}
                        liters={litersOf(d)}
                        ghost={dragging?.id === d.id}
                        onOpen={() => onOpen(d)}
                        onAdvance={(next) => onAdvance(d, next)}
                        onDragStart={(e) => {
                          e.dataTransfer.setData('text/trip', d.id)
                          e.dataTransfer.effectAllowed = 'move'
                          setDragging(d)
                        }}
                        onDragEnd={() => { setDragging(null); setOver(null) }}
                      />
                    ))}
                  </ul>
                </div>
              ))}
              {col.hidden > 0 && (
                <button
                  type="button"
                  onClick={() => setExpanded((prev) => new Set(prev).add(col.status))}
                  className="w-full cursor-pointer rounded-[6px] border-0 bg-transparent py-[6px] text-center font-meta text-[12px] font-semibold text-tealtext hover:bg-fill2"
                >
                  Show {col.hidden} more
                </button>
              )}
              {col.total === 0 && (
                <p className={`m-0 rounded-[8px] border border-dashed py-6 text-center font-meta text-[12px] ${
                  canDrop(col.accepts) ? 'border-tealbright text-tealtext' : 'border-line text-faint'
                }`}>
                  {canDrop(col.accepts) ? `Drop to ${CARD_ACTION[col.accepts as DeliveryStatus]?.toLowerCase()}` : col.hint}
                </p>
              )}
            </div>
          </section>
        )
      })}

      {/* The week's ledger: one line per concluded trip. */}
      <section aria-label="Concluded" className="rounded-[12px] border border-line bg-white p-[8px]">
        <header className="mb-[6px] flex items-baseline gap-[7px] px-[4px] pt-[2px]">
          <p className="m-0 text-[13px] font-semibold">Concluded</p>
          <select
            value={ledgerDays}
            onChange={(e) => { setLedgerDays(Number(e.target.value) as 7 | 30 | 0); setLedgerShown(20) }}
            aria-label="How far back the ledger reaches"
            className="cursor-pointer border-0 bg-transparent p-0 font-meta text-[11px] text-faint"
          >
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={0}>All</option>
          </select>
          {concludedLiters > 0 && <span className="tnum ml-auto whitespace-nowrap font-meta text-[11px] text-faint">{fmtLiters(concludedLiters)}</span>}
        </header>
        {concluded.length === 0 ? (
          <p className="m-0 py-6 text-center font-meta text-[12px] text-faint">{ledgerDays === 7 ? 'Nothing yet this week' : 'Nothing concluded'}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col p-0">
            {concluded.slice(0, ledgerShown).map((d) => {
              const ok = d.status === 'delivered'
              const day = concludedOn(d).slice(0, 10)
              return (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={() => onOpen(d)}
                    aria-label={`${customerOf(d) ?? 'No customer'}, ${ok ? 'delivered' : 'failed'}`}
                    className="flex w-full cursor-pointer items-center gap-[8px] rounded-[6px] border-0 bg-transparent px-[6px] py-[6px] text-left transition-colors hover:bg-fill2"
                  >
                    <span className={`inline-flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-full ${ok ? 'bg-greenbadge text-greentext' : 'bg-redbadge text-redtext'}`} aria-hidden>
                      {ok ? <Check size={10} strokeWidth={3} /> : <X size={10} strokeWidth={3} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-medium leading-[1.25] text-sec">{customerOf(d) ?? 'No customer'}</span>
                      <span className="tnum block truncate font-meta text-[11px] text-faint">
                        {day === today ? 'Today' : fmtDate(day).replace(', 2026', '')}
                        {litersOf(d) ? ` · ${fmtLiters(litersOf(d) as number)}` : ''}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
            {concluded.length > ledgerShown && (
              <li>
                <button
                  type="button"
                  onClick={() => setLedgerShown((n) => n + 40)}
                  className="w-full cursor-pointer rounded-[6px] border-0 bg-transparent py-[6px] text-center font-meta text-[12px] font-semibold text-tealtext hover:bg-fill2"
                >
                  Show {Math.min(40, concluded.length - ledgerShown)} more
                </button>
              </li>
            )}
          </ul>
        )}
      </section>
    </div>
  )
}

function TripCard({ d, today, customer, driver, plate, liters, ghost, onOpen, onAdvance, onDragStart, onDragEnd }: {
  d: Delivery
  today: string
  customer?: string
  driver?: string
  plate?: string
  liters?: number
  ghost: boolean
  onOpen: () => void
  onAdvance: (next: DeliveryStatus) => void
  onDragStart: (e: React.DragEvent) => void
  onDragEnd: () => void
}) {
  const act = STAGE_ACTION[stageOf(d.status)]
  const day = d.scheduleDate.slice(0, 10)
  const late = day < today ? Math.round((Date.parse(today) - Date.parse(day)) / DAY) : 0
  const progress = needsChecklist(d) ? checklistProgress(d.checklist) : null
  const dispatchImminent = d.status === 'scheduled' || d.status === 'loading'
  const noReceipt = d.status === 'in_transit' && !d.documents?.[receiptSlot(d)]?.referenceNo
  // A time only when one was set: a date-only schedule stores midnight, and
  // "00:00" on a card reads as a real slot.
  const time = d.scheduleTime ?? (/T(?!00:00)/.test(d.scheduleDate) ? fmtTime(d.scheduleDate) : '')
  const sub = d.movementType && d.movementType !== 'delivery_to_client' ? MOVEMENT_LABELS[d.movementType] : d.deliveryAddress

  return (
    <li
      role="button"
      tabIndex={0}
      draggable
      aria-label={`${customer ?? 'No customer'}, ${d.status.replace('_', ' ')}`}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen() }}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`group relative cursor-grab overflow-hidden rounded-[8px] border border-line bg-white p-[10px] transition-[border-color,box-shadow,opacity] hover:border-inputline hover:shadow-[0_2px_8px_rgba(20,24,27,.06)] active:cursor-grabbing ${
        late > 0 ? 'pl-[13px]' : ''
      } ${ghost ? 'opacity-40' : ''}`}
    >
      {late > 0 && <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-redf" />}
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold leading-[1.3]">{customer ?? 'No customer'}</span>
          <span className="block truncate font-meta text-[11.5px] text-mut">{sub}</span>
        </span>
        {late > 0 ? (
          <span className="tnum shrink-0 rounded-[5px] bg-redbadge px-[6px] py-[1px] font-meta text-[11px] font-semibold text-redtext">{late}d late</span>
        ) : time ? (
          <span className="tnum shrink-0 font-meta text-[11px] text-faint">{time}</span>
        ) : null}
      </div>

      <div className="mt-[8px] flex flex-wrap items-center gap-x-[10px] gap-y-[4px] font-meta text-[11.5px] text-sec">
        <span className="tnum inline-flex items-center gap-[4px]"><Droplets size={12} strokeWidth={2} className="text-faint" />{liters ? fmtLiters(liters) : '—'}</span>
        <span className={`inline-flex items-center gap-[4px] ${plate ? '' : 'font-semibold text-redtext'}`}>
          <TruckIcon size={12} strokeWidth={2} className={plate ? 'text-faint' : 'text-redtext'} />{plate ?? 'No truck'}
        </span>
        {driver ? (
          <span className="inline-flex items-center gap-[5px]"><Avatar name={driver} size={16} />{driver.split(' ')[0]}</span>
        ) : (
          <span className="font-semibold text-redtext">No crew</span>
        )}
      </div>

      {act && (
        <div className="mt-[8px] flex items-center gap-[8px] border-t border-linesoft pt-[7px]">
          <span className="flex min-w-0 flex-wrap gap-x-[8px] gap-y-[2px] font-meta text-[11px] font-semibold">
            {progress && !progress.complete && (
              <span className={`whitespace-nowrap ${dispatchImminent ? 'text-redtext' : 'text-mut'}`}>
                Checklist {progress.answered}/{progress.total}
              </span>
            )}
            {noReceipt && <span className="whitespace-nowrap text-redtext">No DR no.</span>}
          </span>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onAdvance(act.next) }}
            aria-label={act.label}
            className="ml-auto inline-flex shrink-0 cursor-pointer items-center gap-[4px] whitespace-nowrap rounded-full border border-line bg-white px-[9px] py-[3px] font-meta text-[11px] font-semibold text-lab transition-colors hover:border-ink hover:bg-ink hover:text-white"
          >
            {CARD_ACTION[d.status] ?? act.label} <ArrowRight size={11} strokeWidth={2.4} />
          </button>
        </div>
      )}
    </li>
  )
}
