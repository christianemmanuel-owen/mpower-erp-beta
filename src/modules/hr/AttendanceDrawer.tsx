import { Chip, Dialog, GhostButton } from '../../components/ui'
import { RailClose, RailRow, RailSection } from '../../components/SummaryRail'
import { fmtDate, label } from '../../lib/format'
import {
  classifyDay, eachDateISO, lateUndertimeMins, nightHours, payrollDayShape, r2, weekdayOf, autoOtHours,
} from '../../lib/payroll'
import { leavesInRange, periodTotals, recordsInRange } from './attendancePeriod'
import type { AttendanceRecord, Holiday, LeaveRecord, Shift } from '../../data/types'

/**
 * One employee's period, day by day.
 *
 * The gap this fills: the day view shows one day for everyone and the period
 * view shows a total per person, so the obvious question in between - what did
 * this employee's fortnight actually look like - could only be answered by
 * stepping the date picker through fourteen days and remembering what you saw.
 *
 * Every date in the range gets a row, including the ones with no record at all.
 * A workday with nothing encoded is the thing worth finding, and a list of only
 * the days that exist is exactly the list that cannot show it.
 */
export default function AttendanceDrawer({
  employee, shift, attendance, leaves, holidays, leaveTypes, range, onClose, onOpenDay,
}: {
  employee: { id: string; name: string; role: string } | null
  shift: Shift
  attendance: AttendanceRecord[]
  leaves: LeaveRecord[]
  holidays: Holiday[]
  leaveTypes: { id: string; label: string }[]
  range: { from: string; to: string }
  onClose: () => void
  /** Jump to this date in the day view - the drawer is for reading, the grid is
   *  for fixing, and finding the wrong day here should not mean hunting for it
   *  again there. */
  onOpenDay: (date: string) => void
}) {
  if (!employee) return null

  const mine = recordsInRange(attendance, employee.id, range.from, range.to)
  const myLeaves = leavesInRange(leaves, employee.id, range.from, range.to)
  const totals = { ...periodTotals(mine, shift), leaveDays: myLeaves.length }

  const days = eachDateISO(range.from, range.to).map((date) => {
    const rec = mine.find((a) => a.date === date)
    const leave = myLeaves.find((l) => l.dateFrom <= date && l.dateTo >= date)
    const type = classifyDay(date, holidays, shift)
    const isRest = shift.restDays.includes(weekdayOf(date))
    const shape = payrollDayShape(rec)
    return {
      date, rec, leave, type, isRest, shape,
      late: rec ? lateUndertimeMins(rec, shift) : 0,
      night: rec ? nightHours(rec) : 0,
      ot: rec?.status === 'present' ? (rec.otHours ?? autoOtHours(rec, shift)) : 0,
      // Nobody encoded anything on a day this employee was scheduled to work.
      missing: !rec && !leave && !isRest && type === 'ordinary',
      unpaidGap: rec?.status === 'present' && shape === 'not-worked',
    }
  })

  const unencoded = days.filter((d) => d.missing).length

  return (
    <Dialog
      open
      title={employee.name}
      subtitle={`${label(employee.role)} · ${shift.name} ${shift.startTime}–${shift.endTime}`}
      aside={
        <span className="text-right">
          <span className="block font-meta text-[12px] text-mut">Period</span>
          <span className="block text-[13px] font-semibold leading-[1.2]">
            {fmtDate(range.from)} – {fmtDate(range.to)}
          </span>
        </span>
      }
      onClose={onClose}
      width={900}
      rail={
        <>
          <RailSection title="What payroll will count">
            <RailRow label="Days present" value={r2(totals.present)} />
            <RailRow label="Leave records" value={totals.leaveDays} />
            <RailRow label="Overtime" value={`${r2(totals.ot)} h`} />
            <RailRow label="Night hours" value={`${r2(totals.night)} h`} />
            <RailRow label="Late / undertime" value={`${totals.late} min`} />
          </RailSection>

          <RailSection title="Needs attention">
            <RailRow label="Marked absent" value={totals.absent} />
            <RailRow label="No time out" value={totals.incomplete} />
            <RailClose
              label="Workdays not encoded"
              tone={unencoded > 0 ? 'bad' : 'plain'}
              value={unencoded}
            />
          </RailSection>
        </>
      }
      footer={<GhostButton onClick={onClose}>Close</GhostButton>}
    >
      <div className="overflow-hidden rounded-[8px] border border-line">
        <div className="grid grid-cols-[112px_92px_1fr_60px_60px_auto] items-center gap-3 border-b border-linesoft bg-paper px-[12px] py-[7px] font-meta text-[10px] font-semibold uppercase tracking-[.09em] text-faint">
          <span>Date</span>
          <span>Day</span>
          <span>Stamps</span>
          <span className="text-right">OT</span>
          <span className="text-right">Late</span>
          <span className="text-right">Flags</span>
        </div>
        {days.map((d) => (
          <button
            key={d.date}
            type="button"
            onClick={() => onOpenDay(d.date)}
            title="Open this day in the daily time record"
            className="grid w-full cursor-pointer grid-cols-[112px_92px_1fr_60px_60px_auto] items-center gap-3 border-b border-linesoft bg-transparent px-[12px] py-[7px] text-left text-[13px] last:border-b-0 hover:bg-paper"
          >
            <span className="font-meta text-[12px] text-mut">{fmtDate(d.date).replace(', 2026', '')}</span>
            <span className="font-meta text-[12px] text-mut">
              {d.isRest ? 'Rest day' : d.type === 'ordinary' ? 'Workday' : label(d.type.replace('_rest', ''))}
            </span>
            <span className="tnum min-w-0">
              {d.rec?.timeIn || d.rec?.timeOut ? (
                <>
                  {d.rec.timeIn ?? '—'} <span className="text-faint">to</span>{' '}
                  <span className={d.unpaidGap && !d.rec.timeOut ? 'font-semibold text-redtext' : ''}>
                    {d.rec.timeOut ?? 'no time out'}
                  </span>
                </>
              ) : d.leave ? (
                <span className="font-meta text-[12px] text-mut">
                  On leave - {leaveTypes.find((t) => t.id === d.leave!.typeId)?.label ?? d.leave.typeId}
                </span>
              ) : d.rec?.status === 'absent' ? (
                <span className="font-meta text-[12px] text-mut">Marked absent</span>
              ) : (
                <span className="font-meta text-[12px] text-faint">Nothing encoded</span>
              )}
            </span>
            <span className="tnum text-right font-meta text-[12px] text-mut">{d.ot > 0 ? r2(d.ot) : '—'}</span>
            <span className="tnum text-right font-meta text-[12px] text-mut">{d.late > 0 ? `${d.late}m` : '—'}</span>
            <span className="flex items-center justify-end gap-[6px]">
              {d.unpaidGap && <Chip status="act" text="No time out" />}
              {d.missing && <Chip status="act" text="Not encoded" />}
              {d.night > 0 && <span className="tnum font-meta text-[12px] text-mut">{r2(d.night)}h night</span>}
            </span>
          </button>
        ))}
      </div>
      <p className="m-0 mt-[10px] font-meta text-[12px] text-mut">
        Click a day to open it in the daily time record.
      </p>
    </Dialog>
  )
}
