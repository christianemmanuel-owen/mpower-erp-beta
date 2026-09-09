import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { useTables } from '../../lib/data'
import { repos } from '../../data/repo'
import { useAuth } from '../../lib/auth'
import { useHrConfig } from '../../lib/hrConfig'
import { useRange } from '../../lib/range'
import {
  FALLBACK_SHIFT, autoOtHours, classifyDay, employeeDefaults, lateUndertimeMins,
  nightHours, payrollDayShape, r2, weekdayOf,
} from '../../lib/payroll'
import { todayISO, fmtDate, label } from '../../lib/format'
import { InfoTip, Avatar, Card, Chip, DataTable, GhostButton, Input, Select, TabBar, td } from '../../components/ui'
import AttendanceDrawer from './AttendanceDrawer'
import { leavesInRange, periodTotals, recordsInRange } from './attendancePeriod'
import { RangePicker } from '../../lib/range'
import { useToast } from '../../components/Toast'
import type { AttendanceRecord, Shift } from '../../data/types'


/** One figure from the day, label under value - the shape a number is read in
 *  everywhere else in this app. */
function Count({ value, label: l, bad }: { value: number; label: string; bad?: boolean }) {
  return (
    <span className="text-right">
      <span className={`tnum block text-[15px] font-semibold leading-[1.1] ${bad ? 'text-redtext' : 'text-ink'}`}>
        {value}
      </span>
      <span className="block font-meta text-[11px] text-mut">{l}</span>
    </span>
  )
}

type View = 'day' | 'period'

/**
 * Two views of the same records at two scales - one day for everyone, or a
 * range per person - so they are a switch rather than two cards stacked. They
 * used to be stacked, which meant scrolling past twenty rows of today to reach
 * the totals payroll actually reads.
 *
 * The control that governs what you are looking at travels with the switch: a
 * date for the day, the range picker for the period. It used to be both at
 * once, one of them in the page header three cards away from its own figures.
 */
export default function AttendanceTab() {
  const [view, setView] = useState<View>('day')
  const [date, setDate] = useState(todayISO)
  /** Whose period is open in the drawer. */
  const [detail, setDetail] = useState<string | null>(null)

  return (
    <>
      <div className="mb-[14px] flex flex-wrap items-center gap-[10px]">
        <TabBar
          tabs={['day', 'period'] as const}
          active={view}
          onChange={setView}
          labels={{ day: 'Daily time record', period: 'Period summary' }}
        />
        <span className="ml-auto">
          {view === 'day' ? (
            <Input
              type="date"
              aria-label="Date"
              value={date}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              className="!h-[28px] !w-[150px] font-meta text-[12px]"
            />
          ) : (
            <RangePicker />
          )}
        </span>
      </div>

      {view === 'day'
        ? <DayView date={date} onOpenEmployee={setDetail} />
        : <PeriodView onOpenEmployee={setDetail} />}

      <PeriodDrawer
        employeeId={detail}
        onClose={() => setDetail(null)}
        onOpenDay={(d: string) => { setDate(d); setView('day'); setDetail(null) }}
      />
    </>
  )
}

/**
 * Resolves the row that was clicked into the record the drawer needs.
 *
 * Mounted always, so its hooks run in the same order whether or not a row is
 * open - the drawer itself is the piece that returns null.
 */
function PeriodDrawer({ employeeId, onClose, onOpenDay }: {
  employeeId: string | null
  onClose: () => void
  onOpenDay: (date: string) => void
}) {
  const { config } = useHrConfig()
  const { range } = useRange()
  const data = useTables(['personnel', 'shifts', 'holidays', 'attendance', 'leaves'] as const)
  if (!data) return null
  const { personnel, shifts, holidays, attendance, leaves } = data
  const person = personnel.find((p) => p.id === employeeId)
  const employee = person ? employeeDefaults(person, config) : null
  const shift = shifts.find((sh) => sh.id === employee?.shiftId) ?? (FALLBACK_SHIFT as Shift)

  return (
    <AttendanceDrawer
      employee={employee ? { id: employee.id, name: employee.name, role: employee.role } : null}
      shift={shift}
      attendance={attendance}
      leaves={leaves}
      holidays={holidays}
      leaveTypes={config.leaveTypes}
      range={range}
      onClose={onClose}
      onOpenDay={onOpenDay}
    />
  )
}

function DayView({ date, onOpenEmployee }: { date: string; onOpenEmployee: (id: string) => void }) {
  const { seat } = useAuth()
  const { config } = useHrConfig()
  // The result of Mark all present used to be a sentence appended to the card
  // header, on its own four-second timer, which pushed the counts along the row
  // as it appeared. It is a notification like every other one now.
  const toast = useToast()
  const data = useTables(['personnel', 'shifts', 'holidays', 'attendance', 'leaves'] as const)
  if (!data) return null
  const { personnel, shifts, holidays, attendance, leaves } = data

  const employees = personnel.map((p) => employeeDefaults(p, config)).filter((e) => e.active).sort((a, b) => a.name.localeCompare(b.name))
  const shiftOf = (shiftId?: string | null) => shifts.find((s) => s.id === shiftId) ?? (FALLBACK_SHIFT as Shift)
  const recOf = (empId: string) => attendance.find((a) => a.employeeId === empId && a.date === date)
  const leaveOf = (empId: string, d: string) =>
    leaves.find((l) => l.employeeId === empId && l.dateFrom <= d && l.dateTo >= d)

  const dayHolidays = holidays.filter((h) => h.date === date)
  const encoded = employees.map((e) => ({ e, rec: recOf(e.id), leave: leaveOf(e.id, date), shift: shiftOf(e.shiftId) }))
  const counts = {
    present: encoded.filter((x) => payrollDayShape(x.rec) !== 'not-worked').length,
    incomplete: encoded.filter((x) => x.rec?.status === 'present' && payrollDayShape(x.rec) === 'not-worked').length,
    absent: encoded.filter((x) => !x.leave && (x.rec?.status === 'absent' || (!x.rec && classifyDay(date, holidays, x.shift) === 'ordinary'))).length,
    onLeave: encoded.filter((x) => !x.rec && x.leave).length,
  }

  async function upsert(empId: string, patch: Partial<AttendanceRecord>) {
    const existing = recOf(empId)
    if (existing) await repos.attendance.update(existing.id, patch)
    else await repos.attendance.add({ employeeId: empId, date, status: 'present', sourceSeatId: seat?.id, ...patch })
  }

  /**
   * One write per employee, so a failure part-way through leaves some rows filled
   * and some not. It used to throw out of the loop with no message at all: the
   * operator saw a half-filled grid, no error, and no way to tell whether pressing
   * the button again would double-encode. Now the failures are counted and named.
   */
  async function markAllPresent() {
    let marked = 0
    let skipped = 0
    const failed: string[] = []
    for (const { e, rec, leave } of encoded) {
      const type = classifyDay(date, holidays, shiftOf(e.shiftId))
      if (rec || leave || type !== 'ordinary') {
        skipped++
        continue
      }
      const s = shiftOf(e.shiftId)
      try {
        await upsert(e.id, { status: 'present', timeIn: s.startTime, timeOut: s.endTime })
        marked++
      } catch {
        failed.push(e.name)
      }
    }
    toast(
      failed.length > 0
        ? `Marked ${marked} present · could not save ${failed.length} (${failed.slice(0, 3).join(', ')}${failed.length > 3 ? '…' : ''}) - try again`
        : marked === 0
          ? `Nothing to fill - ${skipped} already encoded, on leave, or off today`
          : `Marked ${marked} present${skipped ? ` · ${skipped} skipped` : ''}`,
    )
  }

  return (
    <>
      <Card delay={50}>
        <div className="flex flex-wrap items-center gap-[10px] border-b border-linesoft px-5 py-[12px]">
          <h3 className="m-0 text-[15px] font-semibold">{fmtDate(date)}</h3>
          {dayHolidays.map((h) => <Chip key={h.id} status={h.kind} text={`${label(h.kind)} - ${h.name}`} />)}
          {/* The day's shape, as four figures rather than a sentence of bolded
              numbers in four colours. Green for present and teal for on leave
              said nothing that the words did not; red is kept for the two that
              need somebody - an absence and a day payroll cannot pay. */}
          <span className="ml-auto flex items-center gap-[18px]">
            <Count value={counts.present} label="present" />
            <Count value={counts.absent} label="absent" bad={counts.absent > 0} />
            <Count value={counts.incomplete} label="no time out" bad={counts.incomplete > 0} />
            <Count value={counts.onLeave} label="on leave" />
            <GhostButton
              size="sm"
              onClick={markAllPresent}
              title="Fills shift times in for every unencoded employee scheduled to work today"
            >
              Mark all present
            </GhostButton>
          </span>
        </div>
        <DataTable
          cols={[
            { label: 'Employee' }, { label: 'Day' }, { label: 'Time in' }, { label: 'Time out' },
            { label: 'Status' }, { label: 'OT (hrs)', align: 'right' }, { label: 'Flags' }, { label: '' },
          ]}
          empty="No active employees yet - add them in the Employees tab."
        >
          {encoded.map(({ e, rec, leave, shift }) => {
            const type = classifyDay(date, holidays, shift)
            const isRest = shift.restDays.includes(weekdayOf(date))
            const onLeaveUnencoded = !rec && leave
            const lateMins = rec ? lateUndertimeMins(rec, shift) : 0
            const night = rec ? nightHours(rec) : 0
            const autoOt = rec ? autoOtHours(rec, shift) : 0
            // Encoded as present but missing a stamp: payroll will pay this day as
            // nothing. Marked on the row itself, not only in the summary at the
            // bottom - the omission happens here, so it has to be visible here.
            const unpaidGap = rec?.status === 'present' && payrollDayShape(rec) === 'not-worked'
            return (
              <tr key={e.id} className="hover:bg-hovrow">
                <td className={`${td} pl-5`}>
                  {/* Only the name is the link. The rest of the row is a grid of
                      controls, and a row-wide click target would open a drawer
                      every time somebody missed a time field. */}
                  <button
                    type="button"
                    onClick={() => onOpenEmployee(e.id)}
                    title={`${e.name}'s attendance for the period`}
                    className="flex cursor-pointer items-center gap-[10px] border-0 bg-transparent p-0 text-left"
                  >
                    <Avatar name={e.name} tint="teal" size={26} />
                    <span>
                      <p className="m-0 font-semibold hover:underline">{e.name}</p>
                      <p className="m-0 text-[12px] text-faint">{label(e.role)} · {shift.name} {shift.startTime}–{shift.endTime}</p>
                    </span>
                  </button>
                </td>
                <td className={`${td} whitespace-nowrap text-[12px] text-mut`}>
                  {isRest ? 'Rest day' : type === 'ordinary' ? 'Workday' : label(type.replace('_rest', ''))}
                </td>
                {onLeaveUnencoded ? (
                  <td className={td} colSpan={5}>
                    <Chip status="on_leave" text={`On leave - ${config.leaveTypes.find((t) => t.id === leave!.typeId)?.label ?? leave!.typeId}`} />
                  </td>
                ) : (
                  <>
                    <td className={td}>
                      <Input
                        type="time"
                        aria-label={`Time in, ${e.name}`}
                        value={rec?.timeIn ?? ''}
                        onChange={(ev) => upsert(e.id, { status: rec?.status === 'absent' ? 'present' : rec?.status ?? 'present', timeIn: ev.target.value || null })}
                        // Red, not amber: a day encoded present with no stamp is
                        // paid as nothing, which is somebody's wages.
                        className={`!h-[28px] !w-[104px] ${unpaidGap && !rec?.timeIn ? '!border-redf' : ''}`}
                      />
                    </td>
                    <td className={td}>
                      <Input
                        type="time"
                        aria-label={`Time out, ${e.name}`}
                        value={rec?.timeOut ?? ''}
                        onChange={(ev) => upsert(e.id, { status: rec?.status === 'absent' ? 'present' : rec?.status ?? 'present', timeOut: ev.target.value || null })}
                        className={`!h-[28px] !w-[104px] ${unpaidGap && !rec?.timeOut ? '!border-redf' : ''}`}
                      />
                    </td>
                    <td className={`${td} whitespace-nowrap`}>
                      <Select
                        aria-label={`Status, ${e.name}`}
                        value={rec ? rec.status : ''}
                        onChange={(ev) => {
                          const v = ev.target.value
                          if (v === '') {
                            if (rec) repos.attendance.remove(rec.id)
                            return
                          }
                          if (v === 'present' && !rec?.timeIn) {
                            upsert(e.id, { status: 'present', timeIn: shift.startTime, timeOut: shift.endTime })
                          } else if (v === 'absent') {
                            upsert(e.id, { status: 'absent', timeIn: null, timeOut: null, otHours: null })
                          } else {
                            upsert(e.id, { status: v as AttendanceRecord['status'] })
                          }
                        }}
                        className="!h-[28px] !w-[136px] font-meta text-[12px]"
                      >
                        <option value="">Not encoded</option>
                        <option value="present">Present</option>
                        <option value="half_day">Half day</option>
                        <option value="absent">Absent</option>
                      </Select>
                    </td>
                    <td className={`${td} text-right`}>
                      {rec?.status === 'present' ? (
                        <Input
                          type="number"
                          step="0.5"
                          min="0"
                          aria-label={`Overtime hours, ${e.name}`}
                          placeholder={autoOt > 0 ? String(r2(autoOt)) : '0'}
                          value={rec.otHours ?? ''}
                          onChange={(ev) => upsert(e.id, { otHours: ev.target.value === '' ? null : Number(ev.target.value) })}
                          title="Auto-computed from time out vs. the shift - type to override"
                          className="nospin tnum !h-[28px] !w-[74px] text-right"
                        />
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </td>
                    <td className={`${td} whitespace-nowrap`}>
                      {/* The Absent and Half day chips that used to sit here only
                          repeated what the Status control beside them already said.
                          What belongs in a flags column is what the row does not
                          otherwise tell you. */}
                      {/* Late minutes and night hours were wearing the colours
                          of unrelated statuses - "pending" amber and "in transit"
                          - to say something that is neither urgent nor a state.
                          They are figures; they read as figures. */}
                      <span className="flex items-center gap-[8px]">
                        {unpaidGap && <Chip status="act" text="No time out" />}
                        {lateMins > 0 && <span className="tnum font-meta text-[12px] text-mut">{lateMins}m late/UT</span>}
                        {night > 0 && <span className="tnum font-meta text-[12px] text-mut">{r2(night)}h night</span>}
                        {rec && leave && <Chip status="act" text="Also on leave" />}
                      </span>
                    </td>
                    <td className={`${td} pr-5 text-right`}>
                      {rec && (
                        <button
                          type="button"
                          onClick={() => repos.attendance.remove(rec.id)}
                          title="Clear this day"
                          aria-label={`Clear this day for ${e.name}`}
                          className="inline-flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-[6px] border-0 bg-transparent text-mut transition-colors hover:bg-fill2 hover:text-redtext"
                        >
                          <Trash2 size={14} strokeWidth={1.8} />
                        </button>
                      )}
                    </td>
                  </>
                )}
              </tr>
            )
          })}
        </DataTable>
      </Card>
    </>
  )
}

/** Per-employee totals for the global date range - the numbers payroll will read. */
function PeriodView({ onOpenEmployee }: { onOpenEmployee: (id: string) => void }) {
  const { config } = useHrConfig()
  const { range } = useRange()
  const data = useTables(['personnel', 'shifts', 'holidays', 'attendance', 'leaves'] as const)
  if (!data) return null
  const { personnel, shifts, attendance, leaves } = data
  const employees = personnel.map((p) => employeeDefaults(p, config)).filter((e) => e.active).sort((a, b) => a.name.localeCompare(b.name))

  // Same arithmetic the drawer runs on one employee - shared rather than
  // written twice, so the row total and the day-by-day behind it cannot come to
  // different answers about, say, whether a half day counts as half a day.
  const rows = employees.map((e) => {
    const shift = shifts.find((s) => s.id === e.shiftId) ?? (FALLBACK_SHIFT as Shift)
    const t = periodTotals(recordsInRange(attendance, e.id, range.from, range.to), shift)
    return {
      e,
      ...t,
      leaveDays: leavesInRange(leaves, e.id, range.from, range.to).length,
      ot: r2(t.ot),
      night: r2(t.night),
    }
  })

  // Payroll reads a column, not a row. Without a total, checking a period meant
  // adding eight columns of figures by hand or exporting them.
  const totals = rows.reduce(
    (t, r) => ({
      present: t.present + r.present,
      absent: t.absent + r.absent,
      incomplete: t.incomplete + r.incomplete,
      leaveDays: t.leaveDays + r.leaveDays,
      ot: t.ot + r.ot,
      night: t.night + r.night,
      late: t.late + r.late,
    }),
    { present: 0, absent: 0, incomplete: 0, leaveDays: 0, ot: 0, night: 0, late: 0 },
  )

  return (
    <Card delay={120}>
      <div className="flex items-center gap-[10px] border-b border-linesoft px-5 py-[12px]">
        <h3 className="m-0 text-[15px] font-semibold">Period summary</h3>
        {/* Which period. The range lives in the page header, three cards away
            from the figures it governs - so a screenshot of this table used to
            be a table of numbers about no particular fortnight. */}
        <span className="font-meta text-[12px] text-mut">
          {fmtDate(range.from)} – {fmtDate(range.to)}
        </span>
        <InfoTip label="How this summary is counted">
          These are the figures payroll will read for this range. A day counts as
          present only when both time stamps are filled in - a row encoded present
          with no time out is counted under "no time out", not under either
          "present" or "absent", because payroll will pay it as neither.
        </InfoTip>
      </div>
      <DataTable
        cols={[
          { label: 'Employee' }, { label: 'Days present', align: 'right' }, { label: 'Marked absent', align: 'right' },
          { label: 'No time out', align: 'right' },
          { label: 'Leave records', align: 'right' }, { label: 'OT hours', align: 'right' },
          { label: 'Night hours', align: 'right' }, { label: 'Late/UT (min)', align: 'right' },
        ]}
        empty="Nothing encoded in this range yet."
      >
        {rows.map((row) => (
          <tr
            key={row.e.id}
            onClick={() => onOpenEmployee(row.e.id)}
            title={`${row.e.name}'s attendance day by day`}
            className="cursor-pointer hover:bg-hovrow"
          >
            <td className={`${td} pl-5 font-semibold`}>{row.e.name}</td>
            <td className={`${td} text-right`}>{row.present}</td>
            <Exception className={td} value={row.absent} />
            <Exception className={td} value={row.incomplete} />
            <td className={`${td} text-right`}>{row.leaveDays}</td>
            <td className={`${td} text-right`}>{row.ot}</td>
            <td className={`${td} text-right`}>{row.night}</td>
            {/* Late minutes are a figure, not an alarm - they were amber, which
                is the colour this app no longer uses for anything. */}
            <Exception className={`${td} pr-5`} value={row.late} tone="plain" />
          </tr>
        ))}
        {rows.length > 0 && (
          <tr className="bg-paper font-semibold">
            <td className={`${td} pl-5`}>All employees</td>
            <td className={`${td} text-right`}>{r2(totals.present)}</td>
            <td className={`${td} text-right ${totals.absent > 0 ? 'text-redtext' : ''}`}>{totals.absent}</td>
            <td className={`${td} text-right ${totals.incomplete > 0 ? 'text-redtext' : ''}`}>{totals.incomplete}</td>
            <td className={`${td} text-right`}>{totals.leaveDays}</td>
            <td className={`${td} text-right`}>{r2(totals.ot)}</td>
            <td className={`${td} text-right`}>{r2(totals.night)}</td>
            <td className={`${td} pr-5 text-right`}>{totals.late}</td>
          </tr>
        )}
      </DataTable>
    </Card>
  )
}

/**
 * A count of things that went wrong, which is usually zero.
 *
 * A grid of zeros reads as data; what matters is the handful of cells that are
 * not. Zero is a dash, and anything above it is red where somebody has to do
 * something about it.
 */
function Exception({ value, className, tone = 'act' }: {
  value: number
  className: string
  tone?: 'act' | 'plain'
}) {
  return (
    <td className={`${className} tnum text-right ${value > 0 && tone === 'act' ? 'font-semibold text-redtext' : ''}`}>
      {value > 0 ? value : <span className="text-faint">—</span>}
    </td>
  )
}
