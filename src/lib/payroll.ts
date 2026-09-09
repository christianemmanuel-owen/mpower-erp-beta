// The payroll brain - pure functions only (no React, no I/O), so every peso the
// client will scrutinize is unit-testable. Money is rounded to centavos at the
// edges; hours are kept exact until priced.
//
// PH rules implemented (multipliers/tables all come from HrConfig, not hardcoded):
//   - OT 125%, rest day 130% (OT 169%), special day 130%/169%, special-on-rest 150%/195%,
//     regular holiday 200%/260%, regular-holiday-on-rest 260%/338% - DOLE defaults.
//   - Night differential +10% of the hourly rate for work between 22:00 and 06:00.
//   - Unworked regular holiday: 100% daily wage for daily-rate employees (present or on
//     paid leave the scheduled workday before); monthly-rate salaries already cover it.
//   - Unworked special non-working day: no work, no pay (daily-rate).
//   - SSS / PhilHealth / Pag-IBIG from the monthly basic equivalent, split per pay period.
//   - Withholding tax from the BIR table matching the pay schedule, on gross minus
//     statutory contributions and non-taxable items.

import { addDaysISO } from './format'
import { commissionLines, commissionTotal, pendingCommission } from './commission'
import type {
  AttendanceRecord, Holiday, HrConfig, LeaveRecord, PaySchedule, Payslip,
  PayslipDays, Personnel, Sale, Shift,
} from '../data/types'

export const r2 = (n: number) => Math.round(n * 100) / 100

// ---- employee defaults ------------------------------------------------------

/** Personnel records from before the HR module have no pay fields - this is the
 * single place that fills the gaps, so every screen agrees on the defaults. */
export function employeeDefaults(p: Personnel, config: HrConfig) {
  return {
    ...p,
    rateType: p.rateType ?? ('daily' as const),
    baseRate: p.baseRate ?? 0,
    allowancePerDay: p.allowancePerDay ?? 0,
    paySchedule: p.paySchedule ?? config.defaultPaySchedule,
    active: p.active ?? true,
    statutory: p.statutory ?? config.statutoryDefaults,
    leaveEntitlements: p.leaveEntitlements ?? [{ typeId: 'sil', daysPerYear: 5 }],
  }
}

export type EmployeeView = ReturnType<typeof employeeDefaults>

/** Used when an employee has no shift assigned: 8–5, hour lunch, Sundays off. */
export const FALLBACK_SHIFT: Pick<Shift, 'name' | 'startTime' | 'endTime' | 'breakMinutes' | 'restDays'> = {
  name: 'Default',
  startTime: '08:00',
  endTime: '17:00',
  breakMinutes: 60,
  restDays: [0],
}

// ---- calendar helpers -------------------------------------------------------

export const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + (m || 0)
}

/** 0 (Sun) – 6 (Sat), timezone-proof (UTC calendar space, like addDaysISO). */
export const weekdayOf = (date: string) => new Date(`${date.slice(0, 10)}T00:00:00Z`).getUTCDay()

export function eachDateISO(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = from.slice(0, 10); d <= to.slice(0, 10); d = addDaysISO(d, 1)) out.push(d)
  return out
}

export type DayType =
  | 'ordinary'
  | 'rest'
  | 'special'
  | 'special_rest'
  | 'regular_holiday'
  | 'regular_holiday_rest'

/** What kind of pay day a date is for someone on this shift. Special working
 * days are ordinary pay by definition, so they classify as ordinary (or rest). */
export function classifyDay(date: string, holidays: Holiday[], shift: Pick<Shift, 'restDays'>): DayType {
  const isRest = shift.restDays.includes(weekdayOf(date))
  const todays = holidays.filter((h) => h.date === date)
  const kind = todays.some((h) => h.kind === 'regular')
    ? 'regular'
    : todays.some((h) => h.kind === 'special_nonworking')
      ? 'special_nonworking'
      : null
  if (kind === 'regular') return isRest ? 'regular_holiday_rest' : 'regular_holiday'
  if (kind === 'special_nonworking') return isRest ? 'special_rest' : 'special'
  return isRest ? 'rest' : 'ordinary'
}

const isWorkday = (t: DayType) => t === 'ordinary'

// ---- attendance-derived hours (also used by the Attendance grid) ------------

/** Minutes actually on the clock (span minus break), 0 without both stamps. */
export function workedMinutes(rec: Pick<AttendanceRecord, 'timeIn' | 'timeOut'>, shift: Pick<Shift, 'breakMinutes'>): number {
  if (!rec.timeIn || !rec.timeOut) return 0
  const start = minutesOf(rec.timeIn)
  let end = minutesOf(rec.timeOut)
  if (end <= start) end += 1440 // crossed midnight
  return Math.max(0, end - start - shift.breakMinutes)
}

/** Minutes late (after shift start) plus undertime (before shift end). */
export function lateUndertimeMins(
  rec: Pick<AttendanceRecord, 'timeIn' | 'timeOut' | 'status'>,
  shift: Pick<Shift, 'startTime' | 'endTime' | 'breakMinutes'>,
): number {
  if (rec.status !== 'present' || !rec.timeIn || !rec.timeOut) return 0
  const shiftStart = minutesOf(shift.startTime)
  let shiftEnd = minutesOf(shift.endTime)
  if (shiftEnd <= shiftStart) shiftEnd += 1440
  const tin = minutesOf(rec.timeIn)
  let tout = minutesOf(rec.timeOut)
  if (tout <= tin) tout += 1440
  const late = Math.max(0, tin - shiftStart)
  const undertime = Math.max(0, shiftEnd - tout)
  const paidShift = Math.max(0, shiftEnd - shiftStart - shift.breakMinutes)
  return Math.min(late + undertime, paidShift)
}

/** Hours past the scheduled shift end - the auto value the encoder can override. */
export function autoOtHours(
  rec: Pick<AttendanceRecord, 'timeIn' | 'timeOut' | 'status'>,
  shift: Pick<Shift, 'startTime' | 'endTime'>,
): number {
  if (rec.status !== 'present' || !rec.timeIn || !rec.timeOut) return 0
  const shiftStart = minutesOf(shift.startTime)
  let shiftEnd = minutesOf(shift.endTime)
  if (shiftEnd <= shiftStart) shiftEnd += 1440
  const tin = minutesOf(rec.timeIn)
  let tout = minutesOf(rec.timeOut)
  if (tout <= tin) tout += 1440
  return Math.max(0, (tout - shiftEnd) / 60)
}

/** Hours worked inside 22:00–06:00 (night differential window). Break time is
 * assumed to fall outside the window - close enough for encoding-level data. */
export function nightHours(rec: Pick<AttendanceRecord, 'timeIn' | 'timeOut' | 'status'>): number {
  if (rec.status !== 'present' || !rec.timeIn || !rec.timeOut) return 0
  const tin = minutesOf(rec.timeIn)
  let tout = minutesOf(rec.timeOut)
  if (tout <= tin) tout += 1440
  // Night windows on a 0–2880 minute timeline: 00:00–06:00, 22:00–06:00(+1d), 22:00(+1d)–…
  const windows: [number, number][] = [[0, 360], [1320, 1800], [2760, 2880]]
  let mins = 0
  for (const [a, b] of windows) mins += Math.max(0, Math.min(tout, b) - Math.max(tin, a))
  return mins / 60
}

// ---- leave helpers ----------------------------------------------------------

/** Days a leave record actually consumes: scheduled workdays only - rest days and
 * holidays inside the range don't burn balance (nobody works those anyway). */
export function leaveDaysInRange(
  leave: Pick<LeaveRecord, 'dateFrom' | 'dateTo'>,
  holidays: Holiday[],
  shift: Pick<Shift, 'restDays'>,
  clampFrom?: string,
  clampTo?: string,
): string[] {
  const from = clampFrom && clampFrom > leave.dateFrom ? clampFrom : leave.dateFrom
  const to = clampTo && clampTo < leave.dateTo ? clampTo : leave.dateTo
  if (from > to) return []
  return eachDateISO(from, to).filter((d) => isWorkday(classifyDay(d, holidays, shift)))
}

/** Balance = entitlement − days used this calendar year (may go negative - the UI
 * warns and treats the overdraw as unpaid). */
export function leaveDaysUsed(
  leaves: LeaveRecord[],
  employeeId: string,
  typeId: string,
  year: number,
  holidays: Holiday[],
  shift: Pick<Shift, 'restDays'>,
): number {
  const from = `${year}-01-01`
  const to = `${year}-12-31`
  return leaves
    .filter((l) => l.employeeId === employeeId && l.typeId === typeId && l.dateFrom <= to && l.dateTo >= from)
    .reduce((sum, l) => sum + leaveDaysInRange(l, holidays, shift, from, to).length, 0)
}

// ---- statutory --------------------------------------------------------------

/** SSS monthly salary credit: salary rounded to the nearest step, clamped. */
export function sssMsc(monthlyBasic: number, t: HrConfig['sss']): number {
  return Math.min(t.maxMsc, Math.max(t.minMsc, Math.round(monthlyBasic / t.step) * t.step))
}

export const sssEmployeeMonthly = (monthlyBasic: number, t: HrConfig['sss']) => r2(sssMsc(monthlyBasic, t) * t.eeRate)

export function philhealthEmployeeMonthly(monthlyBasic: number, t: HrConfig['philhealth']): number {
  const base = Math.min(t.ceiling, Math.max(t.floor, monthlyBasic))
  return r2(base * t.rate * t.eeShare)
}

export const pagibigEmployeeMonthly = (monthlyBasic: number, t: HrConfig['pagibig']) =>
  r2(Math.min(monthlyBasic, t.maxFundSalary) * t.eeRate)

/** Share of a monthly amount charged to one pay period. Weekly uses 12/52 (not /4)
 * so the year sums to exactly twelve monthly contributions. */
export function perPeriod(monthlyAmount: number, schedule: PaySchedule): number {
  if (schedule === 'monthly') return r2(monthlyAmount)
  if (schedule === 'semi_monthly') return r2(monthlyAmount / 2)
  return r2((monthlyAmount * 12) / 52)
}

/** BIR bracket lookup: highest bracket whose `over` ≤ income. The daily table is
 * unused by the pay schedules but kept addressable for the Setup screen. */
export function withholdingTax(taxable: number, schedule: PaySchedule | 'daily', config: HrConfig): number {
  const table = config.withholding[schedule]
  const bracket = [...table].sort((a, b) => a.over - b.over).reduce((hit, b) => (taxable >= b.over ? b : hit), table[0])
  return r2(Math.max(0, bracket.baseTax + bracket.rate * (taxable - bracket.over)))
}

// ---- commission -------------------------------------------------------------

/**
 * Commission for one employee in one cutoff - Exhibit A 1.7.
 *
 * This used to pay on any sale FULFILLED within the period, regardless of
 * whether the customer had paid. Exhibit A requires the opposite: commission is
 * "approved for payout only once the corresponding collection is recorded as
 * collected". The rules now live in src/lib/commission.ts; see the note at the
 * top of that file for why the period follows the collection rather than the
 * sale, and why part-collected plans release proportionally.
 */
export function commissionFromSales(emp: EmployeeView, sales: Sale[], periodStart: string, periodEnd: string): number {
  if (!emp.agentId || !emp.commissionRate) return 0
  return commissionTotal(commissionLines(emp.agentId, emp.commissionRate, sales, periodStart, periodEnd))
}

/** The same figure broken into its collections, so a payslip can show its
 * working when an agent asks where the number came from. */
export function commissionDetail(emp: EmployeeView, sales: Sale[], periodStart: string, periodEnd: string) {
  if (!emp.agentId || !emp.commissionRate) return []
  return commissionLines(emp.agentId, emp.commissionRate, sales, periodStart, periodEnd)
}

/** Commission earned on paper but not yet payable, because the money has not
 * arrived. Shown alongside the payslip so the gate reads as a rule rather than
 * an error. */
export function commissionWaiting(emp: EmployeeView, sales: Sale[]): number {
  if (!emp.agentId || !emp.commissionRate) return 0
  return pendingCommission(emp.agentId, emp.commissionRate, sales)
}

// ---- the payslip ------------------------------------------------------------

export interface PayslipInputs {
  employee: Personnel
  config: HrConfig
  /** The employee's assigned shift; falls back to 8–5 Mon–Sat when unassigned. */
  shift: Pick<Shift, 'name' | 'startTime' | 'endTime' | 'breakMinutes' | 'restDays'> | undefined
  holidays: Holiday[]
  /** All attendance for this employee - days before the period matter for the
   * unworked-holiday eligibility check, so don't pre-filter to the cutoff. */
  attendance: AttendanceRecord[]
  leaves: LeaveRecord[]
  sales: Sale[]
  periodStart: string
  periodEnd: string
  paySchedule: PaySchedule
}

const emptyDays = (): PayslipDays => ({
  daysWorked: 0, daysAbsent: 0, paidLeaveDays: 0, unpaidLeaveDays: 0,
  regularOtHours: 0, restDayHours: 0, restDayOtHours: 0,
  specialDayHours: 0, specialDayOtHours: 0,
  regularHolidayHours: 0, regularHolidayOtHours: 0,
  nightDiffHours: 0, lateUndertimeMinutes: 0, unworkedRegularHolidays: 0,
})

/** Was the employee present (or on paid leave) on the scheduled workday right
 * before `date`? Regular-holiday pay for daily-rate employees hinges on this.
 * Employees with no attendance history at all get the benefit of the doubt. */
function eligibleForHolidayPay(
  date: string,
  holidays: Holiday[],
  shift: Pick<Shift, 'restDays'>,
  attendance: AttendanceRecord[],
  paidLeaveDates: Set<string>,
): boolean {
  if (!attendance.some((a) => a.date < date)) return true
  for (let d = addDaysISO(date, -1), i = 0; i < 14; d = addDaysISO(d, -1), i++) {
    if (!isWorkday(classifyDay(d, holidays, shift))) continue
    if (paidLeaveDates.has(d)) return true
    const rec = attendance.find((a) => a.date === d)
    return !!rec && rec.status !== 'absent'
  }
  return true
}

/**
 * How payroll reads one attendance record. Exported because the attendance grid
 * shows a "what payroll will read for these dates" summary, and it used to answer
 * this question itself - keying off `status` alone. A row encoded present at 08:00
 * whose time-out was never filled in counted as a day present on that summary and
 * as a day ABSENT on the payslip (with a day's pay deducted for monthly staff).
 * Two screens, the same question, two answers. There is now one function.
 */
export function payrollDayShape(rec: AttendanceRecord | undefined): 'present' | 'half' | 'not-worked' {
  if (rec?.status === 'half_day') return 'half'
  if (rec?.status === 'present' && !!rec.timeIn && !!rec.timeOut) return 'present'
  return 'not-worked'
}

export function computePayslip(inp: PayslipInputs): Payslip {
  const { config, holidays, sales, periodStart, periodEnd, paySchedule } = inp
  const emp = employeeDefaults(inp.employee, config)
  const shift = inp.shift ?? FALLBACK_SHIFT
  const monthly = emp.rateType === 'monthly'
  const dailyRate = monthly ? emp.baseRate / config.monthlyWorkDays : emp.baseRate
  const hourlyRate = dailyRate / config.workdayHours
  const perMinute = hourlyRate / 60
  const prem = config.premiumRates
  const paidLeaveTypes = new Set(config.leaveTypes.filter((t) => t.paid).map((t) => t.id))

  // Every date each leave record covers, split paid/unpaid - computed once.
  const paidLeaveDates = new Set<string>()
  const unpaidLeaveDates = new Set<string>()
  for (const leave of inp.leaves.filter((l) => l.employeeId === emp.id)) {
    const target = paidLeaveTypes.has(leave.typeId) ? paidLeaveDates : unpaidLeaveDates
    for (const d of leaveDaysInRange(leave, holidays, shift)) target.add(d)
  }

  const byDate = new Map(inp.attendance.filter((a) => a.employeeId === emp.id).map((a) => [a.date, a]))
  const days = emptyDays()
  let basicPay = 0
  let overtimePay = 0
  let nightDiffPay = 0
  let restDayPay = 0
  let holidayPay = 0
  let lateUndertimeDed = 0
  let absencesDed = 0

  for (const date of eachDateISO(periodStart, periodEnd)) {
    const type = classifyDay(date, holidays, shift)
    const rec = byDate.get(date)
    const shape = payrollDayShape(rec)
    const present = shape === 'present'
    const halfDay = shape === 'half'

    if (present || halfDay) {
      const dayFraction = halfDay ? 0.5 : 1
      const ot = halfDay ? 0 : (rec!.otHours ?? autoOtHours(rec!, shift))
      const night = halfDay ? 0 : nightHours(rec!)
      days.daysWorked += dayFraction
      days.nightDiffHours += night
      nightDiffPay += night * hourlyRate * prem.nightDiff

      if (type === 'ordinary') {
        // Monthly salaries already cover ordinary days - only daily rates accrue.
        if (!monthly) basicPay += dailyRate * dayFraction
        days.regularOtHours += ot
        overtimePay += ot * hourlyRate * prem.ordinaryOt
        if (!halfDay) {
          const lu = lateUndertimeMins(rec!, shift)
          days.lateUndertimeMinutes += lu
          lateUndertimeDed += lu * perMinute
        }
      } else if (type === 'rest') {
        // A monthly salary (÷26 convention) never includes rest days, so both
        // rate types earn the full premium here.
        days.restDayHours += config.workdayHours * dayFraction
        days.restDayOtHours += ot
        restDayPay += dailyRate * prem.restDay * dayFraction
        overtimePay += ot * hourlyRate * prem.restDayOt
      } else if (type === 'special' || type === 'special_rest') {
        const mult = type === 'special' ? prem.specialDay : prem.specialRestDay
        const otMult = type === 'special' ? prem.specialDayOt : prem.specialRestDayOt
        days.specialDayHours += config.workdayHours * dayFraction
        days.specialDayOtHours += ot
        // Monthly rates already include scheduled workdays (special or not) - pay
        // only the premium on top; on a rest day nothing is pre-paid, pay in full.
        const covered = monthly && type === 'special' ? 1 : 0
        holidayPay += dailyRate * (mult - covered) * dayFraction
        overtimePay += ot * hourlyRate * otMult
      } else {
        const mult = type === 'regular_holiday' ? prem.regularHoliday : prem.regularHolidayRestDay
        const otMult = type === 'regular_holiday' ? prem.regularHolidayOt : prem.regularHolidayRestDayOt
        days.regularHolidayHours += config.workdayHours * dayFraction
        days.regularHolidayOtHours += ot
        const covered = monthly && type === 'regular_holiday' ? 1 : 0
        holidayPay += dailyRate * (mult - covered) * dayFraction
        overtimePay += ot * hourlyRate * otMult
      }
      if (halfDay && type === 'ordinary') {
        days.daysAbsent += 0.5
        if (monthly) absencesDed += dailyRate * 0.5
      }
      continue
    }

    // Not worked. Only scheduled workdays and regular holidays owe anything.
    if (type === 'ordinary') {
      if (paidLeaveDates.has(date)) {
        days.paidLeaveDays += 1
        if (!monthly) basicPay += dailyRate
      } else if (unpaidLeaveDates.has(date)) {
        days.unpaidLeaveDays += 1
        if (monthly) absencesDed += dailyRate
      } else if (!emp.hireDate || date >= emp.hireDate.slice(0, 10)) {
        days.daysAbsent += 1
        if (monthly) absencesDed += dailyRate
      }
    } else if ((type === 'regular_holiday' || type === 'regular_holiday_rest') && !monthly) {
      if (eligibleForHolidayPay(date, holidays, shift, inp.attendance.filter((a) => a.employeeId === emp.id), paidLeaveDates)) {
        days.unworkedRegularHolidays += 1
        holidayPay += dailyRate
      }
    }
  }

  // Monthly-rate basic: a fixed slice of the month regardless of calendar days.
  if (monthly) {
    basicPay = paySchedule === 'monthly' ? emp.baseRate : paySchedule === 'semi_monthly' ? emp.baseRate / 2 : (emp.baseRate * 12) / 52
  }

  const allowance = emp.allowancePerDay * (days.daysWorked + days.paidLeaveDays)
  const commission = commissionFromSales(emp, sales, periodStart, periodEnd)

  const monthlyBasic = monthly ? emp.baseRate : emp.baseRate * config.monthlyWorkDays
  const sss = emp.statutory.sss ? perPeriod(sssEmployeeMonthly(monthlyBasic, config.sss), paySchedule) : 0
  const philhealth = emp.statutory.philhealth ? perPeriod(philhealthEmployeeMonthly(monthlyBasic, config.philhealth), paySchedule) : 0
  const pagibig = emp.statutory.pagibig ? perPeriod(pagibigEmployeeMonthly(monthlyBasic, config.pagibig), paySchedule) : 0

  const slip: Payslip = {
    employeeId: emp.id,
    employeeName: emp.name,
    role: emp.role,
    rateType: emp.rateType,
    baseRate: emp.baseRate,
    days: {
      ...days,
      nightDiffHours: r2(days.nightDiffHours),
      regularOtHours: r2(days.regularOtHours),
      restDayOtHours: r2(days.restDayOtHours),
      specialDayOtHours: r2(days.specialDayOtHours),
      regularHolidayOtHours: r2(days.regularHolidayOtHours),
    },
    earnings: {
      basicPay: r2(basicPay),
      overtimePay: r2(overtimePay),
      nightDiffPay: r2(nightDiffPay),
      restDayPay: r2(restDayPay),
      holidayPay: r2(holidayPay),
      allowance: r2(allowance),
      commission,
      bonus: 0,
      bonusTaxable: true,
      incentive: 0,
      incentiveTaxable: true,
      otherEarnings: [],
    },
    deductions: {
      sss,
      philhealth,
      pagibig,
      withholdingTax: 0,
      lateUndertime: r2(lateUndertimeDed),
      absences: r2(absencesDed),
      otherDeductions: [],
    },
    grossPay: 0,
    taxableIncome: 0,
    totalDeductions: 0,
    netPay: 0,
  }
  recomputeTax(slip, config, paySchedule, emp.statutory.withholdingTax)
  return slip
}

/** Recomputes taxable income + withholding, then the totals. Called after the
 * initial build and again whenever the draft editor changes any line. */
export function recomputeTax(slip: Payslip, config: HrConfig, schedule: PaySchedule, withholdEnabled: boolean): Payslip {
  const e = slip.earnings
  const d = slip.deductions
  const nonTaxable =
    e.allowance +
    (e.bonusTaxable ? 0 : e.bonus) +
    (e.incentiveTaxable ? 0 : e.incentive) +
    e.otherEarnings.filter((l) => !l.taxable).reduce((s, l) => s + l.amount, 0)
  const gross =
    e.basicPay + e.overtimePay + e.nightDiffPay + e.restDayPay + e.holidayPay +
    e.allowance + e.commission + e.bonus + e.incentive +
    e.otherEarnings.reduce((s, l) => s + l.amount, 0)
  // Late/undertime and absences reduce pay before tax - they're earnings that never
  // happened, shown as deductions so the payslip reads the way PH payslips read.
  const taxable = Math.max(0, gross - d.lateUndertime - d.absences - nonTaxable - d.sss - d.philhealth - d.pagibig)
  slip.taxableIncome = r2(taxable)
  slip.deductions.withholdingTax = withholdEnabled ? withholdingTax(taxable, schedule, config) : 0
  return recomputeTotals(slip)
}

/** Totals only - for edits where the operator has hand-set the tax. */
export function recomputeTotals(slip: Payslip): Payslip {
  const e = slip.earnings
  const d = slip.deductions
  slip.grossPay = r2(
    e.basicPay + e.overtimePay + e.nightDiffPay + e.restDayPay + e.holidayPay +
    e.allowance + e.commission + e.bonus + e.incentive +
    e.otherEarnings.reduce((s, l) => s + l.amount, 0),
  )
  slip.totalDeductions = r2(
    d.sss + d.philhealth + d.pagibig + d.withholdingTax + d.lateUndertime + d.absences +
    d.otherDeductions.reduce((s, l) => s + l.amount, 0),
  )
  slip.netPay = r2(slip.grossPay - slip.totalDeductions)
  return slip
}

// ---- 13th month -------------------------------------------------------------

/** 1/12 of basic salary earned in the calendar year (PD 851). Reads finalized
 * runs' basic pay; include drafts for a mid-year preview if desired. */
export function thirteenthMonth(
  runs: { periodStart: string; status: string; payslips: Payslip[] }[],
  year: number,
  includeDrafts = false,
): { employeeId: string; employeeName: string; basicEarned: number; amount: number }[] {
  const byEmployee = new Map<string, { employeeName: string; basicEarned: number }>()
  for (const run of runs) {
    if (!run.periodStart.startsWith(String(year))) continue
    if (run.status !== 'finalized' && !includeDrafts) continue
    for (const slip of run.payslips) {
      const cur = byEmployee.get(slip.employeeId) ?? { employeeName: slip.employeeName, basicEarned: 0 }
      cur.basicEarned += slip.earnings.basicPay
      byEmployee.set(slip.employeeId, cur)
    }
  }
  return [...byEmployee.entries()]
    .map(([employeeId, v]) => ({ employeeId, employeeName: v.employeeName, basicEarned: r2(v.basicEarned), amount: r2(v.basicEarned / 12) }))
    .sort((a, b) => b.amount - a.amount)
}

// ---- cutoff suggestions -----------------------------------------------------

/** The most recently *completed* pay period before `today` - what "Run payroll"
 * pre-fills. Semi-monthly: 1–15 / 16–end; weekly: Mon–Sun; monthly: 1–end. */
export function suggestCutoff(schedule: PaySchedule, today: string): { periodStart: string; periodEnd: string } {
  const d = today.slice(0, 10)
  const [y, m, day] = d.split('-').map(Number)
  const iso = (yy: number, mm: number, dd: number) => `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
  const lastDayOf = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).getUTCDate()
  const prevMonth = (): [number, number] => (m === 1 ? [y - 1, 12] : [y, m - 1])

  if (schedule === 'monthly') {
    const [py, pm] = prevMonth()
    return { periodStart: iso(py, pm, 1), periodEnd: iso(py, pm, lastDayOf(py, pm)) }
  }
  if (schedule === 'semi_monthly') {
    if (day > 15) return { periodStart: iso(y, m, 1), periodEnd: iso(y, m, 15) }
    const [py, pm] = prevMonth()
    return { periodStart: iso(py, pm, 16), periodEnd: iso(py, pm, lastDayOf(py, pm)) }
  }
  // weekly - the Monday–Sunday week before the current one
  const wd = weekdayOf(d) // 0 Sun … 6 Sat
  const daysSinceMonday = (wd + 6) % 7
  const lastSunday = addDaysISO(d, -daysSinceMonday - 1)
  return { periodStart: addDaysISO(lastSunday, -6), periodEnd: lastSunday }
}
