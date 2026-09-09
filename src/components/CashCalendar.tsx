import { useMemo, useState } from 'react'
import {
  addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameMonth, isToday, startOfMonth, startOfWeek,
} from 'date-fns'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { fmtCompactPeso, fmtCurrency } from '../lib/format'
import { PrimaryButton, Chip, GhostButton, Dialog } from './ui'

/** One open installment plotted on its due date. Kind decides the badge color and the
 * resolve-button label: 'in' = receivable (mark collected), 'out' = payable (mark paid). */
export interface CashEvent {
  kind: 'in' | 'out'
  /** The parent sale/purchase id - an installment is resolved by updating one entry inside
   * that record's installments array, not the whole record. */
  parentId: string
  installmentId: string
  date: string // yyyy-MM-dd
  amount: number
  name: string
  overdue: boolean
}

const weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Month-grid of open installments plotted on their due dates, with a per-day slide-over that
 * can resolve each entry. Shared by the Dashboard (receivables + payables) and the Collection
 * module (receivables only) - callers own event building and the resolve write; the payable
 * legend chip only renders when 'out' events exist. */
export default function CashCalendar({ events, onResolve }: {
  events: CashEvent[]
  onResolve: (e: CashEvent) => void | Promise<void>
}) {
  const [monthOffset, setMonthOffset] = useState(0)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)

  const byDay = useMemo(() => {
    const map = new Map<string, CashEvent[]>()
    for (const e of events) {
      const list = map.get(e.date) ?? []
      list.push(e)
      map.set(e.date, list)
    }
    return map
  }, [events])

  const sum = (list: CashEvent[]) => list.reduce((s, e) => s + e.amount, 0)
  const totalIn = events.filter((e) => e.kind === 'in')
  const totalOut = events.filter((e) => e.kind === 'out')
  const totalOverdue = events.filter((e) => e.overdue)
  const hasPayables = totalOut.length > 0

  const viewedMonth = addMonths(new Date(), monthOffset)
  const monthStart = startOfMonth(viewedMonth)
  const monthEnd = endOfMonth(viewedMonth)
  const days = eachDayOfInterval({ start: startOfWeek(monthStart), end: endOfWeek(monthEnd) })

  const selectedEvents = selectedDay ? (byDay.get(selectedDay) ?? []) : []

  async function resolve(e: CashEvent) {
    await onResolve(e)
    setSelectedDay(null)
  }

  return (
    <>
      {/* Month nav and the period totals. Amounts read as text rather than
          filled pills - a month with activity on twenty days was forty badges,
          which turned a calendar into a wall of chips. */}
      <div className="mb-[10px] flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setMonthOffset((m) => m - 1)}
            aria-label="Previous month"
            className="flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-[6px] border-0 bg-transparent text-mut transition-colors hover:bg-fill2 hover:text-ink"
          >
            <ChevronLeft size={15} strokeWidth={1.8} />
          </button>
          <p className="m-0 min-w-[118px] text-center text-[13px] font-semibold">{format(viewedMonth, 'MMMM yyyy')}</p>
          <button
            onClick={() => setMonthOffset((m) => m + 1)}
            aria-label="Next month"
            className="flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-[6px] border-0 bg-transparent text-mut transition-colors hover:bg-fill2 hover:text-ink"
          >
            <ChevronRight size={15} strokeWidth={1.8} />
          </button>
          {monthOffset !== 0 && (
            <button
              onClick={() => setMonthOffset(0)}
              className="ml-1 cursor-pointer rounded-[6px] border border-inputline bg-white px-[9px] py-[3px] font-meta text-[12px] font-semibold text-lab hover:bg-fill2"
            >
              Today
            </button>
          )}
        </div>
        <div className="flex items-center gap-4 font-meta text-[12px] text-mut">
          <span>Receivable <span className="tnum font-semibold text-tealtext">{fmtCompactPeso(sum(totalIn))}</span></span>
          {hasPayables && (
            <span>Payable <span className="tnum font-semibold text-ambertext">{fmtCompactPeso(sum(totalOut))}</span></span>
          )}
          {totalOverdue.length > 0 && (
            <span className="tnum font-semibold text-redtext">{totalOverdue.length} overdue · {fmtCompactPeso(sum(totalOverdue))}</span>
          )}
        </div>
      </div>

      {/* One ruled grid, not forty-two cards. The 1px gaps over a line-coloured
          ground draw the dividers, so there are no per-cell borders to double up
          against their neighbours. */}
      <div className="overflow-hidden rounded-[8px] border border-line">
        <div className="grid grid-cols-7 gap-px bg-line">
          {weekdayLabels.map((d) => (
            <span key={d} className="bg-fill2 py-[6px] text-center font-meta text-[10px] font-semibold uppercase tracking-[.09em] text-mut">
              {d}
            </span>
          ))}
          {days.map((day) => {
            const key = format(day, 'yyyy-MM-dd')
            const dayEvents = byDay.get(key) ?? []
            const inAmt = sum(dayEvents.filter((e) => e.kind === 'in'))
            const outAmt = sum(dayEvents.filter((e) => e.kind === 'out'))
            const hasOverdue = dayEvents.some((e) => e.overdue)
            const inMonth = isSameMonth(day, viewedMonth)
            const active = dayEvents.length > 0
            return (
              <button
                key={key}
                onClick={() => active && setSelectedDay(key)}
                disabled={!active}
                aria-label={`${format(day, 'd MMMM')}${active ? `, ${dayEvents.length} due` : ', nothing due'}`}
                className={`flex min-h-[74px] flex-col items-stretch p-[7px] text-left transition-colors ${
                  inMonth ? 'bg-white' : 'bg-paper'
                } ${active ? 'cursor-pointer hover:bg-fill2' : 'cursor-default'}`}
              >
                <span
                  className={`tnum self-start text-[12px] leading-[18px] ${
                    isToday(day)
                      ? 'h-[18px] min-w-[18px] rounded-full bg-ink px-[5px] text-center font-semibold text-white'
                      : inMonth ? 'font-normal text-lab' : 'text-faint'
                  }`}
                >
                  {format(day, 'd')}
                </span>
                {active && (
                  <span className="mt-auto flex flex-col items-start gap-[1px] pt-1">
                    {inAmt > 0 && (
                      <span className={`tnum font-meta text-[12px] font-semibold ${hasOverdue ? 'text-redtext' : 'text-tealtext'}`}>
                        +{fmtCompactPeso(inAmt)}
                      </span>
                    )}
                    {outAmt > 0 && (
                      <span className="tnum font-meta text-[12px] font-semibold text-ambertext">
                        &minus;{fmtCompactPeso(outAmt)}
                      </span>
                    )}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      <Dialog
        open={!!selectedDay} title={selectedDay ? format(new Date(`${selectedDay}T00:00:00`), 'MMMM d, yyyy') : ''} onClose={() => setSelectedDay(null)}
        footer={<span className="ml-auto"><GhostButton onClick={() => setSelectedDay(null)}>Close</GhostButton></span>}
      >
        <div className="flex flex-col gap-2">
          {selectedEvents.map((e) => (
            <div key={`${e.kind}_${e.installmentId}`} className="flex items-center gap-3 rounded-[10px] border border-line p-3">
              <div className="flex-1">
                <p className="m-0 text-[13px] font-semibold">{e.name}</p>
                <p className="tnum m-0 text-[12px] text-mut">{e.kind === 'in' ? 'To collect' : 'To pay'} · {fmtCurrency(e.amount).replace('.00', '')}</p>
              </div>
              {e.overdue && <Chip status="overdue" text="Overdue" />}
              <PrimaryButton size="sm" onClick={() => resolve(e)}>{e.kind === 'in' ? 'Mark collected' : 'Mark paid'}</PrimaryButton>
            </div>
          ))}
          {selectedEvents.length === 0 && <p className="py-6 text-center text-[13px] text-faint">Nothing due this day.</p>}
        </div>
      </Dialog>
    </>
  )
}
