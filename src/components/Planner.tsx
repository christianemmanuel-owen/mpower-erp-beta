import { useMemo, useState, type ReactNode } from 'react'
import { useOpenRecord } from '../lib/peek'
import {
  addMonths, addWeeks, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameMonth, isToday,
  startOfMonth, startOfWeek,
} from 'date-fns'
import { ArrowDownLeft, ArrowUpRight, ChevronLeft, ChevronRight, Landmark, Truck, UserMinus, Wrench } from 'lucide-react'
import { fmtCompactPeso, fmtCurrency, fmtLiters } from '../lib/format'
import { LAYERS, byDay, type PlannerEvent, type PlannerLayer } from '../lib/planner'

/**
 * One calendar for everything with a date on it - Home's Calendar subpage,
 * and Collect's calendar tab with one layer on.
 *
 * A grid and an agenda, side by side. The grid is for the shape of the
 * month: each day shows its first few entries as short coloured lines, so a
 * heavy week looks heavy without a click. The agenda on the right is for the
 * day you are on - today until you pick another - written out in full, with
 * everything past due gathered above it, because "164 past due" is a number
 * you have to be able to open.
 *
 * The calendar never writes. Every entry opens the screen that owns it - the
 * settle dialog on that installment, the trip drawer on that trip - because
 * those dialogs ask for the things a calendar click cannot: the date the money
 * actually came, the check number, the DR number, who signed.
 */

const LAYER_STYLE: Record<PlannerLayer, { text: string; dot: string; bar: string; icon: ReactNode; verb: string }> = {
  trips: { text: 'text-lab', dot: 'bg-ink', bar: 'bg-ink/10 text-ink', icon: <Truck size={11} strokeWidth={2.2} />, verb: 'Open trip' },
  in: { text: 'text-tealtext', dot: 'bg-tealbright', bar: 'bg-tealbadge text-tealtext', icon: <ArrowDownLeft size={11} strokeWidth={2.4} />, verb: 'Settle' },
  bank: { text: 'text-sec', dot: 'bg-sec', bar: 'bg-fill2 text-sec', icon: <Landmark size={11} strokeWidth={2} />, verb: 'Open Treasury' },
  out: { text: 'text-ambertext', dot: 'bg-amber', bar: 'bg-amberbadge text-ambertext', icon: <ArrowUpRight size={11} strokeWidth={2.4} />, verb: 'Open Payables' },
  fleet: { text: 'text-mut', dot: 'bg-mut', bar: 'bg-fill2 text-mut', icon: <Wrench size={11} strokeWidth={2} />, verb: 'Open Maintenance' },
  people: { text: 'text-mut', dot: 'bg-faint', bar: 'bg-fill2 text-mut', icon: <UserMinus size={11} strokeWidth={2} />, verb: 'Open Employees' },
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const key = (d: Date) => format(d, 'yyyy-MM-dd')
const sum = (list: PlannerEvent[]) => list.reduce((s, e) => s + (e.amount ?? 0), 0)
const amountOf = (e: PlannerEvent) =>
  e.amount === undefined ? null : e.layer === 'trips' ? fmtLiters(e.amount) : fmtCurrency(e.amount).replace('.00', '')

export type PlannerView = 'month' | 'week'

export default function Planner({
  events, layers, activeLayers, onLayers, view = 'month', onView,
}: {
  events: PlannerEvent[]
  /** Which layers this screen offers; the switches show only these. */
  layers: readonly PlannerLayer[]
  activeLayers: readonly PlannerLayer[]
  onLayers?: (next: PlannerLayer[]) => void
  view?: PlannerView
  onView?: (v: PlannerView) => void
}) {
  const [offset, setOffset] = useState(0)
  // Which way the grid came from, for the slide when it changes: forward
  // enters from the right, back from the left, a view change from the right.
  const [dir, setDir] = useState<'right' | 'left'>('right')
  const go = (delta: number) => { setDir(delta > 0 ? 'right' : 'left'); setOffset((m) => m + delta) }
  const today = key(new Date())
  const [selectedDay, setSelectedDay] = useState<string>(today)
  const [showPastDue, setShowPastDue] = useState(false)
  const openRecord = useOpenRecord()

  const shown = useMemo(() => {
    const on = new Set(activeLayers)
    return events.filter((e) => on.has(e.layer))
  }, [events, activeLayers])
  const days = useMemo(() => byDay(shown), [shown])

  const anchor = view === 'week' ? addWeeks(new Date(), offset) : addMonths(new Date(), offset)
  const range = view === 'week'
    ? { start: startOfWeek(anchor), end: endOfWeek(anchor) }
    : { start: startOfWeek(startOfMonth(anchor)), end: endOfWeek(endOfMonth(anchor)) }
  const cells = eachDayOfInterval(range)
  const title = view === 'week'
    ? `${format(range.start, 'MMM d')} – ${format(range.end, isSameMonth(range.start, range.end) ? 'd, yyyy' : 'MMM d, yyyy')}`
    : format(anchor, 'MMMM yyyy')

  const inPeriod = shown.filter((e) => e.date >= key(range.start) && e.date <= key(range.end))
  const pastDue = shown.filter((e) => e.overdue)

  const toggle = (l: PlannerLayer) => {
    if (!onLayers) return
    onLayers(activeLayers.includes(l) ? activeLayers.filter((x) => x !== l) : [...activeLayers, l])
  }
  const open = (e: PlannerEvent) => { if (e.href) openRecord(e.href) }
  const pick = (k: string) => { setSelectedDay(k); setShowPastDue(false) }

  const selected = days.get(selectedDay) ?? []
  const agendaTitle = selectedDay === today ? 'Today' : format(new Date(`${selectedDay}T00:00:00`), 'EEEE')
  const agendaDate = format(new Date(`${selectedDay}T00:00:00`), 'MMMM d, yyyy')

  return (
    <div className="grid gap-[16px] lg:grid-cols-[1fr_300px]">
      <div className="min-w-0">
        {/* Month name, arrows, the view, and the layer switches on one line. */}
        <div className="mb-[12px] flex flex-wrap items-center gap-x-[14px] gap-y-[8px]">
          <div className="flex items-center gap-[2px]">
            <button
              onClick={() => go(-1)}
              aria-label={view === 'week' ? 'Previous week' : 'Previous month'}
              className="flex h-[28px] w-[28px] cursor-pointer items-center justify-center rounded-[6px] border-0 bg-transparent text-mut transition-colors hover:bg-fill2 hover:text-ink"
            >
              <ChevronLeft size={16} strokeWidth={1.8} />
            </button>
            <button
              onClick={() => go(1)}
              aria-label={view === 'week' ? 'Next week' : 'Next month'}
              className="flex h-[28px] w-[28px] cursor-pointer items-center justify-center rounded-[6px] border-0 bg-transparent text-mut transition-colors hover:bg-fill2 hover:text-ink"
            >
              <ChevronRight size={16} strokeWidth={1.8} />
            </button>
          </div>
          <h2 className="m-0 text-[17px] font-semibold tracking-[-0.01em]">{title}</h2>
          <button
            onClick={() => { setDir(offset > 0 ? 'left' : 'right'); setOffset(0); pick(today) }}
            className="cursor-pointer rounded-[6px] border border-inputline bg-white px-[9px] py-[3px] font-meta text-[12px] font-semibold text-lab hover:bg-fill2"
          >
            Today
          </button>

          {onView && (
            <div className="flex rounded-[6px] border border-line bg-fill2 p-[2px]" role="tablist" aria-label="View">
              {(['month', 'week'] as const).map((v) => (
                <button
                  key={v}
                  role="tab"
                  aria-selected={view === v}
                  onClick={() => { setDir('right'); onView(v); setOffset(0) }}
                  className={`cursor-pointer rounded-[5px] border-0 px-[10px] py-[3px] font-meta text-[12px] font-semibold capitalize ${
                    view === v ? 'bg-white text-ink shadow-[0_1px_2px_rgba(20,24,27,.08)]' : 'bg-transparent text-mut hover:text-ink'
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          )}

          {/* The switches: a coloured dot and a word, lit when on. They read
              as the legend for the marks in the grid, which they are. */}
          {onLayers && (
            <div className="ml-auto flex flex-wrap items-center gap-[2px]" aria-label="Layers">
              {LAYERS.filter((l) => layers.includes(l.key)).map((l) => {
                const on = activeLayers.includes(l.key)
                return (
                  <button
                    key={l.key}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(l.key)}
                    className={`inline-flex cursor-pointer items-center gap-[6px] rounded-[6px] border-0 bg-transparent px-[8px] py-[4px] font-meta text-[12px] font-semibold transition-colors hover:bg-fill2 ${
                      on ? 'text-lab' : 'text-faint line-through decoration-faint/60'
                    }`}
                  >
                    <span className={`h-[8px] w-[8px] rounded-full ${on ? LAYER_STYLE[l.key].dot : 'bg-line'}`} aria-hidden />
                    {l.label}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Keyed on view and period, so each change re-mounts the grid and
            it slides in from the side it came from. */}
        <div key={`${view}:${offset}`} className={dir === 'right' ? 'slide-from-right' : 'slide-from-left'}>
          {view === 'week'
            ? <WeekGrid cells={cells} days={days} selected={selectedDay} onDay={pick} onOpen={open} />
            : <MonthGrid cells={cells} days={days} anchor={anchor} selected={selectedDay} onDay={pick} />}
        </div>

        <p className="m-0 mt-[8px] font-meta text-[12px] text-faint">
          {inPeriod.length} item{inPeriod.length === 1 ? '' : 's'} this {view === 'week' ? 'week' : 'month'}
        </p>
      </div>

      {/* The agenda: past due first, then the day in hand. */}
      <aside className="flex min-w-0 flex-col gap-[14px]">
        {pastDue.length > 0 && (
          <button
            type="button"
            onClick={() => setShowPastDue((v) => !v)}
            aria-expanded={showPastDue}
            className={`flex w-full cursor-pointer items-center gap-[10px] rounded-[8px] border px-[12px] py-[10px] text-left transition-colors ${
              showPastDue ? 'border-redf bg-redbadge' : 'border-line bg-white hover:bg-fill2'
            }`}
          >
            <span className="h-[8px] w-[8px] shrink-0 rounded-full bg-redf" aria-hidden />
            <span className="text-[13px] font-semibold text-redtext">{pastDue.length} past due</span>
            <span className="tnum ml-auto font-meta text-[12px] text-redtext">{fmtCompactPeso(sum(pastDue.filter((e) => e.layer !== 'trips')))}</span>
          </button>
        )}

        <div className="rounded-[8px] border border-line bg-white">
          <div className="flex items-baseline gap-[8px] border-b border-linesoft px-[12px] py-[10px]">
            <p className="m-0 text-[13px] font-semibold">{showPastDue ? 'Past due' : agendaTitle}</p>
            <p className="m-0 font-meta text-[12px] text-mut">{showPastDue ? 'oldest first' : agendaDate}</p>
            {!showPastDue && selected.length > 0 && <span className="tnum ml-auto font-meta text-[12px] text-faint">{selected.length}</span>}
          </div>
          <div key={showPastDue ? 'past-due' : selectedDay} className="fade-only max-h-[640px] overflow-y-auto p-[8px] [scrollbar-width:thin]">
            <Agenda events={showPastDue ? pastDue : selected} onOpen={open} empty={showPastDue ? 'Nothing past due.' : 'Nothing on this day.'} />
          </div>
        </div>
      </aside>
    </div>
  )
}

/**
 * A short coloured line for one entry: who it is. The figure is left to the
 * agenda - in a month cell there is room for a name or a number, and the
 * name is what tells two entries apart.
 */
function Mark({ e, amount = false }: { e: PlannerEvent; amount?: boolean }) {
  const st = LAYER_STYLE[e.layer]
  const figure = amount ? amountOf(e) : null
  return (
    <span className={`flex items-center gap-[4px] rounded-[4px] px-[5px] py-[1px] font-meta text-[11px] font-semibold leading-[16px] ${e.overdue ? 'bg-redbadge text-redtext' : st.bar}`}>
      <span className="shrink-0 opacity-80" aria-hidden>{st.icon}</span>
      <span className="min-w-0 truncate">{e.title}</span>
      {figure && <span className="tnum ml-auto shrink-0 pl-[4px] opacity-80">{figure.replace('₱', '')}</span>}
    </span>
  )
}

const PER_CELL = 3
const PER_COLUMN = 8

function MonthGrid({ cells, days, anchor, selected, onDay }: {
  cells: Date[]
  days: Map<string, PlannerEvent[]>
  anchor: Date
  selected: string
  onDay: (k: string) => void
}) {
  return (
    <div className="overflow-hidden rounded-[8px] border border-line">
      <div className="grid grid-cols-7 gap-px bg-line">
        {WEEKDAYS.map((d) => (
          <span key={d} className="bg-fill2 py-[6px] text-center font-meta text-[10px] font-semibold uppercase tracking-[.09em] text-mut">{d}</span>
        ))}
        {cells.map((day) => {
          const k = key(day)
          const list = days.get(k) ?? []
          const inMonth = isSameMonth(day, anchor)
          const on = k === selected
          const more = list.length - PER_CELL
          return (
            <button
              key={k}
              onClick={() => onDay(k)}
              aria-label={`${format(day, 'd MMMM')}, ${list.length} item${list.length === 1 ? '' : 's'}`}
              aria-pressed={on}
              className={`flex min-h-[96px] cursor-pointer flex-col items-stretch gap-[3px] p-[6px] text-left transition-colors ${
                inMonth ? 'bg-white hover:bg-fill2' : 'bg-paper hover:bg-fill2'
              } ${on ? 'shadow-[inset_0_0_0_2px_var(--color-tealbright)]' : ''
              }`}
            >
              <span className={`tnum mb-[2px] self-start text-[12px] leading-[18px] ${
                isToday(day)
                  ? 'h-[18px] min-w-[18px] rounded-full bg-ink px-[5px] text-center font-semibold text-white'
                  : inMonth ? 'text-lab' : 'text-faint'
              }`}>
                {format(day, 'd')}
              </span>
              {list.slice(0, PER_CELL).map((e) => <Mark key={e.id} e={e} />)}
              {more > 0 && <span className="px-[5px] font-meta text-[11px] font-semibold text-mut">{more} more</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Seven columns, every entry written out. */
function WeekGrid({ cells, days, selected, onDay, onOpen }: {
  cells: Date[]; days: Map<string, PlannerEvent[]>; selected: string; onDay: (k: string) => void; onOpen: (e: PlannerEvent) => void
}) {
  return (
    <div className="overflow-hidden rounded-[8px] border border-line">
      <div className="grid grid-cols-7 gap-px bg-line">
        {cells.map((day) => {
          const k = key(day)
          const list = days.get(k) ?? []
          const on = k === selected
          return (
            <div key={k} className={`flex min-h-[360px] flex-col bg-white ${on ? 'shadow-[inset_0_0_0_2px_var(--color-tealbright)]' : ''}`}>
              <button
                type="button"
                onClick={() => onDay(k)}
                className={`m-0 flex w-full cursor-pointer items-baseline gap-[6px] border-0 border-b border-linesoft bg-transparent px-[8px] py-[6px] text-left font-meta text-[11px] font-semibold uppercase tracking-[.08em] ${isToday(day) ? 'text-ink' : 'text-mut'}`}
              >
                {format(day, 'EEE')}
                <span className={`tnum text-[13px] normal-case tracking-normal ${isToday(day) ? 'rounded-full bg-ink px-[6px] text-white' : 'text-lab'}`}>{format(day, 'd')}</span>
                {list.length > 0 && <span className="tnum ml-auto text-[11px] normal-case tracking-normal text-faint">{list.length}</span>}
              </button>
              {/* A column holds a working day's worth; a day with fifty
                  entries is read in the agenda, not by scrolling a column
                  taller than the screen. */}
              <ul className="m-0 flex list-none flex-col gap-[3px] p-[5px]">
                {list.slice(0, PER_COLUMN).map((e) => (
                  <li key={e.id}>
                    <button
                      type="button"
                      onClick={() => onOpen(e)}
                      disabled={!e.href}
                      aria-label={e.href ? `${LAYER_STYLE[e.layer].verb}: ${e.title}` : e.title}
                      className={`block w-full cursor-pointer border-0 bg-transparent p-0 text-left ${e.href ? '' : 'cursor-default'}`}
                    >
                      <Mark e={e} />
                      {/* The figure under the name rather than beside it: a
                          seventh of the page is not wide enough for both. */}
                      <span className="block truncate px-[5px] font-meta text-[10.5px] text-faint">
                        {amountOf(e) && <span className={`tnum font-semibold ${e.overdue ? 'text-redtext' : LAYER_STYLE[e.layer].text}`}>{amountOf(e)}</span>}
                        {amountOf(e) && e.sub ? ' · ' : ''}{e.sub}
                      </span>
                    </button>
                  </li>
                ))}
                {list.length > PER_COLUMN && (
                  <li>
                    <button
                      type="button"
                      onClick={() => onDay(k)}
                      className="w-full cursor-pointer rounded-[4px] border-0 bg-transparent px-[5px] py-[4px] text-left font-meta text-[11px] font-semibold text-mut hover:bg-fill2 hover:text-ink"
                    >
                      {list.length - PER_COLUMN} more
                    </button>
                  </li>
                )}
              </ul>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** The day written out, grouped by kind. */
function Agenda({ events, onOpen, empty }: { events: PlannerEvent[]; onOpen: (e: PlannerEvent) => void; empty: string }) {
  if (events.length === 0) return <p className="m-0 py-8 text-center font-meta text-[12.5px] text-faint">{empty}</p>
  const groups = LAYERS.filter((l) => events.some((e) => e.layer === l.key))
  return (
    <div className="flex flex-col gap-[12px]">
      {groups.map((g) => {
        const list = events.filter((e) => e.layer === g.key)
        const st = LAYER_STYLE[g.key]
        return (
          <section key={g.key}>
            <p className={`m-0 mb-[4px] flex items-center gap-[6px] px-[4px] font-meta text-[10px] font-semibold uppercase tracking-[.09em] ${st.text}`}>
              {st.icon}{g.label}
              <span className="text-faint">{list.length}</span>
              {g.key !== 'trips' && list.some((e) => e.amount) && <span className="tnum ml-auto text-sec">{fmtCurrency(sum(list)).replace('.00', '')}</span>}
            </p>
            <ul className="m-0 flex list-none flex-col p-0">
              {list.map((e) => {
                const amount = amountOf(e)
                return (
                  <li key={e.id}>
                    <button
                      type="button"
                      onClick={() => onOpen(e)}
                      disabled={!e.href}
                      aria-label={e.href ? `${st.verb}: ${e.title}` : e.title}
                      className={`group flex w-full items-start gap-[8px] rounded-[6px] border-0 bg-transparent px-[6px] py-[6px] text-left transition-colors ${e.href ? 'cursor-pointer hover:bg-fill2' : 'cursor-default'}`}
                    >
                      <span className={`mt-[5px] h-[7px] w-[7px] shrink-0 rounded-full ${e.overdue ? 'bg-redf' : st.dot}`} aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold leading-[1.25]">{e.title}</span>
                        <span className="block truncate font-meta text-[11px] text-mut">
                          {e.overdue && <span className="text-redtext">{format(new Date(`${e.date}T00:00:00`), 'MMM d')} · </span>}{e.sub}
                        </span>
                      </span>
                      {amount && <span className={`tnum shrink-0 font-meta text-[12px] font-semibold ${e.overdue ? 'text-redtext' : st.text}`}>{amount}</span>}
                      {e.href && <ArrowUpRight size={13} strokeWidth={2} className="mt-[2px] shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100" />}
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
