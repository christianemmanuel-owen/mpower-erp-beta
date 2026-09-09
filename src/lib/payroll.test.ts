import { describe, expect, it } from 'vitest'
import {
  autoOtHours, classifyDay, commissionFromSales, commissionWaiting, computePayslip, eachDateISO, employeeDefaults,
  lateUndertimeMins, leaveDaysInRange, leaveDaysUsed, minutesOf, nightHours, pagibigEmployeeMonthly,
  perPeriod, philhealthEmployeeMonthly, recomputeTax, sssEmployeeMonthly, sssMsc, suggestCutoff,
  thirteenthMonth, weekdayOf, withholdingTax, workedMinutes,
} from './payroll'
import { DEFAULT_HR_CONFIG } from '../data/statutory'
import type { AttendanceRecord, Holiday, LeaveRecord, Payslip, Personnel, Sale, Shift } from '../data/types'

const cfg = DEFAULT_HR_CONFIG
const base = { id: 'x', createdAt: '', updatedAt: '' }

const dayShift: Shift = { ...base, id: 'sh1', name: 'Day', startTime: '08:00', endTime: '17:00', breakMinutes: 60, restDays: [0] }
const nightShift: Shift = { ...base, id: 'sh2', name: 'Night', startTime: '22:00', endTime: '06:00', breakMinutes: 0, restDays: [0] }

const holiday = (date: string, kind: Holiday['kind'] = 'regular'): Holiday => ({ ...base, id: `h-${date}`, date, name: 'H', kind })
// June 2026: the 1st is a Monday, Sundays are 7/14/21/28, June 12 (Fri) is Independence Day.
const june12 = holiday('2026-06-12', 'regular')

function emp(p: Partial<Personnel>): Personnel {
  return { ...base, id: 'e1', name: 'Juan Dela Cruz', role: 'driver', contactNumber: '', rateType: 'daily', baseRate: 700, ...p } as Personnel
}

function att(date: string, p: Partial<AttendanceRecord> = {}): AttendanceRecord {
  return { ...base, id: `a-${date}`, employeeId: 'e1', date, status: 'present', timeIn: '08:00', timeOut: '17:00', ...p }
}

/** Present 08:00–17:00 on every ordinary workday (Mon–Sat, non-holiday) in the range. */
function fullAttendance(from: string, to: string, holidays: Holiday[] = []): AttendanceRecord[] {
  return eachDateISO(from, to)
    .filter((d) => classifyDay(d, holidays, dayShift) === 'ordinary')
    .map((d) => att(d))
}

describe('calendar & classification', () => {
  it('parses times and weekdays', () => {
    expect(minutesOf('08:30')).toBe(510)
    expect(weekdayOf('2026-07-19')).toBe(0) // a Sunday
    expect(weekdayOf('2026-06-01')).toBe(1) // a Monday
  })

  it('classifies the holiday × rest-day matrix', () => {
    expect(classifyDay('2026-06-01', [], dayShift)).toBe('ordinary')
    expect(classifyDay('2026-06-07', [], dayShift)).toBe('rest') // Sunday
    expect(classifyDay('2026-06-12', [june12], dayShift)).toBe('regular_holiday')
    expect(classifyDay('2026-06-07', [holiday('2026-06-07')], dayShift)).toBe('regular_holiday_rest')
    expect(classifyDay('2026-06-10', [holiday('2026-06-10', 'special_nonworking')], dayShift)).toBe('special')
    expect(classifyDay('2026-06-07', [holiday('2026-06-07', 'special_nonworking')], dayShift)).toBe('special_rest')
    // special working days are ordinary pay
    expect(classifyDay('2026-06-10', [holiday('2026-06-10', 'special_working')], dayShift)).toBe('ordinary')
  })
})

describe('attendance-derived hours', () => {
  it('computes worked minutes, including shifts crossing midnight', () => {
    expect(workedMinutes(att('2026-06-01'), dayShift)).toBe(480)
    expect(workedMinutes(att('2026-06-01', { timeIn: '22:00', timeOut: '06:00' }), nightShift)).toBe(480)
  })

  it('computes late + undertime, capped at the paid shift', () => {
    expect(lateUndertimeMins(att('d', { timeIn: '08:30' }), dayShift)).toBe(30)
    expect(lateUndertimeMins(att('d', { timeOut: '16:30' }), dayShift)).toBe(30)
    expect(lateUndertimeMins(att('d', { timeIn: '08:30', timeOut: '16:30' }), dayShift)).toBe(60)
    expect(lateUndertimeMins(att('d'), dayShift)).toBe(0)
  })

  it('derives OT past shift end, cross-midnight included', () => {
    expect(autoOtHours(att('d', { timeOut: '19:00' }), dayShift)).toBe(2)
    expect(autoOtHours(att('d'), dayShift)).toBe(0)
    expect(autoOtHours(att('d', { timeIn: '22:00', timeOut: '08:00' }), nightShift)).toBe(2)
  })

  it('counts night-differential hours in the 22:00–06:00 window', () => {
    expect(nightHours(att('d', { timeIn: '22:00', timeOut: '06:00' }))).toBe(8)
    expect(nightHours(att('d', { timeIn: '21:00', timeOut: '23:00' }))).toBe(1)
    expect(nightHours(att('d', { timeIn: '04:00', timeOut: '08:00' }))).toBe(2)
    expect(nightHours(att('d'))).toBe(0)
  })
})

describe('leave math', () => {
  const leave = (dateFrom: string, dateTo: string, typeId = 'sil'): LeaveRecord =>
    ({ ...base, id: 'l1', employeeId: 'e1', typeId, dateFrom, dateTo })

  it('burns balance only on scheduled workdays', () => {
    // Fri Jun 5 → Mon Jun 8, Sunday the 7th is rest: Fri, Sat, Mon = 3 days
    expect(leaveDaysInRange(leave('2026-06-05', '2026-06-08'), [], dayShift)).toHaveLength(3)
    // a regular holiday inside the range doesn't burn balance either
    expect(leaveDaysInRange(leave('2026-06-11', '2026-06-13'), [june12], dayShift)).toHaveLength(2)
  })

  it('sums usage within one calendar year', () => {
    const leaves = [leave('2026-06-05', '2026-06-08'), leave('2025-12-31', '2026-01-02')]
    // 3 from June + Jan 1–2 (Thu holiday + Fri): Jan 1 2026 is a regular holiday
    expect(leaveDaysUsed(leaves, 'e1', 'sil', 2026, [holiday('2026-01-01')], dayShift)).toBe(4)
  })
})

describe('statutory tables', () => {
  it('SSS: MSC clamps and rounds to the bracket, EE = 5%', () => {
    expect(sssMsc(4_000, cfg.sss)).toBe(5_000)
    expect(sssMsc(5_250, cfg.sss)).toBe(5_500)
    expect(sssMsc(18_200, cfg.sss)).toBe(18_000)
    expect(sssMsc(90_000, cfg.sss)).toBe(35_000)
    expect(sssEmployeeMonthly(90_000, cfg.sss)).toBe(1_750)
  })

  it('PhilHealth: 5% split equally, floored and capped', () => {
    expect(philhealthEmployeeMonthly(8_000, cfg.philhealth)).toBe(250)
    expect(philhealthEmployeeMonthly(30_000, cfg.philhealth)).toBe(750)
    expect(philhealthEmployeeMonthly(150_000, cfg.philhealth)).toBe(2_500)
  })

  it('Pag-IBIG: 2% of fund salary, ₱200 cap', () => {
    expect(pagibigEmployeeMonthly(4_000, cfg.pagibig)).toBe(80)
    expect(pagibigEmployeeMonthly(30_000, cfg.pagibig)).toBe(200)
  })

  it('splits monthly amounts per schedule (weekly sums to a true year)', () => {
    expect(perPeriod(1_000, 'monthly')).toBe(1_000)
    expect(perPeriod(1_000, 'semi_monthly')).toBe(500)
    expect(perPeriod(1_000, 'weekly')).toBe(230.77)
  })

  it('BIR withholding: bracket edges per schedule', () => {
    expect(withholdingTax(10_000, 'semi_monthly', cfg)).toBe(0)
    expect(withholdingTax(10_417, 'semi_monthly', cfg)).toBe(0)
    expect(withholdingTax(12_000, 'semi_monthly', cfg)).toBe(r((12_000 - 10_417) * 0.15))
    expect(withholdingTax(16_667, 'semi_monthly', cfg)).toBe(937.5)
    expect(withholdingTax(20_000, 'semi_monthly', cfg)).toBe(r(937.5 + (20_000 - 16_667) * 0.2))
    expect(withholdingTax(20_833, 'monthly', cfg)).toBe(0)
    expect(withholdingTax(25_000, 'monthly', cfg)).toBe(r((25_000 - 20_833) * 0.15))
    expect(withholdingTax(5_000, 'weekly', cfg)).toBe(r((5_000 - 4_808) * 0.15))
    expect(withholdingTax(700, 'daily', cfg)).toBe(r((700 - 685) * 0.15))
  })
})

const r = (n: number) => Math.round(n * 100) / 100

describe('commission', () => {
  // Behaviour change, deliberate: commission used to be paid on any sale
  // FULFILLED in the cutoff. Exhibit A 1.7 requires it to be gated on
  // collection - "approved for payout only once the corresponding collection is
  // recorded as collected" - so an uncollected sale now pays nothing, and the
  // period follows the collection rather than the sale. The full rule set is
  // exercised in src/lib/commission.test.ts; these cover the payroll seam.
  const sale = (s: Partial<Sale>): Sale =>
    ({ ...base, id: 's1', agentId: 'ag1', customerId: 'c1', date: '2026-06-05', pricePerLiter: 58, volumeLiters: 4_000, warehouseId: 'w1', fulfillment: 'pickup', paymentMode: 'cash', installments: [], status: 'fulfilled', ...s }) as Sale

  /** 4,000 L at ₱58 = ₱232,000, collected on the given date. */
  const collectedOn = (date: string) => ({
    installments: [{
      id: 'i1', amount: 232_000, principal: 232_000, interestPct: 0,
      dueDate: date, status: 'collected' as const, collectedAt: date,
    }],
  })

  const seller = employeeDefaults(emp({ agentId: 'ag1', commissionRate: { kind: 'per_liter', value: 0.3 } }), cfg)

  it('pays at ₱/L or % of sale once the money is collected', () => {
    const s = sale(collectedOn('2026-06-05'))
    expect(commissionFromSales(seller, [s], '2026-06-01', '2026-06-15')).toBe(1_200)
    const pct = employeeDefaults(emp({ agentId: 'ag1', commissionRate: { kind: 'percent_of_sale', value: 1 } }), cfg)
    expect(commissionFromSales(pct, [s], '2026-06-01', '2026-06-15')).toBe(2_320)
  })

  it('pays nothing on a fulfilled sale nobody has paid for yet', () => {
    const unpaid = sale({
      installments: [{
        id: 'i1', amount: 232_000, principal: 232_000, interestPct: 0,
        dueDate: '2026-06-30', status: 'pending',
      }],
    })
    expect(commissionFromSales(seller, [unpaid], '2026-06-01', '2026-06-15')).toBe(0)
  })

  it('ignores drafts, other agents, and collections outside the period', () => {
    expect(commissionFromSales(seller, [sale({ status: 'draft', ...collectedOn('2026-06-05') })], '2026-06-01', '2026-06-15')).toBe(0)
    expect(commissionFromSales(seller, [sale({ agentId: 'ag2', ...collectedOn('2026-06-05') })], '2026-06-01', '2026-06-15')).toBe(0)
    expect(commissionFromSales(seller, [sale(collectedOn('2026-05-30'))], '2026-06-01', '2026-06-15')).toBe(0)
  })

  it('pays an old sale in the cutoff its money actually arrived in', () => {
    // Sold in May, collected in June. Paying on sale date would lose this
    // commission entirely.
    const s = sale({ date: '2026-05-02', ...collectedOn('2026-06-05') })
    expect(commissionFromSales(seller, [s], '2026-06-01', '2026-06-15')).toBe(1_200)
  })

  it('reports what is still waiting on collection', () => {
    const unpaid = sale({
      installments: [{
        id: 'i1', amount: 232_000, principal: 232_000, interestPct: 0,
        dueDate: '2026-06-30', status: 'pending',
      }],
    })
    expect(commissionWaiting(seller, [unpaid])).toBe(1_200)
  })
})

describe('computePayslip - daily rate', () => {
  const period = { periodStart: '2026-06-01', periodEnd: '2026-06-15', paySchedule: 'semi_monthly' as const }
  const inputs = (overrides: Partial<Parameters<typeof computePayslip>[0]> = {}) => ({
    employee: emp({ allowancePerDay: 50 }),
    config: cfg,
    shift: dayShift,
    holidays: [june12],
    attendance: fullAttendance('2026-06-01', '2026-06-15', [june12]),
    leaves: [],
    sales: [],
    ...period,
    ...overrides,
  })

  it('pays worked days, the unworked regular holiday, and allowance; statutory splits per cutoff', () => {
    const slip = computePayslip(inputs())
    expect(slip.days.daysWorked).toBe(12) // 13 Mon–Sat workdays minus the holiday
    expect(slip.days.unworkedRegularHolidays).toBe(1)
    expect(slip.days.daysAbsent).toBe(0)
    expect(slip.earnings.basicPay).toBe(12 * 700)
    expect(slip.earnings.holidayPay).toBe(700)
    expect(slip.earnings.allowance).toBe(12 * 50)
    // monthly basic 700×26 = 18,200 → SSS MSC 18,000 → ₱900/mo → 450; PhilHealth 455 → 227.50; Pag-IBIG 200 → 100
    expect(slip.deductions.sss).toBe(450)
    expect(slip.deductions.philhealth).toBe(227.5)
    expect(slip.deductions.pagibig).toBe(100)
    expect(slip.taxableIncome).toBe(r(12 * 700 + 700 - 450 - 227.5 - 100)) // allowance non-taxable
    expect(slip.deductions.withholdingTax).toBe(0) // below the semi-monthly threshold
    expect(slip.netPay).toBe(r(slip.grossPay - 450 - 227.5 - 100))
  })

  it('denies holiday pay after an absence the workday before, absences just don’t accrue pay', () => {
    const attendance = fullAttendance('2026-06-01', '2026-06-15', [june12])
      .map((a) => (a.date === '2026-06-11' ? { ...a, status: 'absent' as const, timeIn: undefined, timeOut: undefined } : a))
    const slip = computePayslip(inputs({ attendance }))
    expect(slip.days.unworkedRegularHolidays).toBe(0)
    expect(slip.earnings.holidayPay).toBe(0)
    expect(slip.days.daysAbsent).toBe(1)
    expect(slip.deductions.absences).toBe(0) // daily rate: no work, no pay - not a deduction
    expect(slip.earnings.basicPay).toBe(11 * 700)
  })

  it('prices rest-day work, ordinary OT, and late minutes', () => {
    const attendance = [
      ...fullAttendance('2026-06-01', '2026-06-15', [june12]).map((a) =>
        a.date === '2026-06-02' ? { ...a, otHours: 2 } : a.date === '2026-06-03' ? { ...a, timeIn: '08:30' } : a,
      ),
      att('2026-06-07'), // Sunday
    ]
    const slip = computePayslip(inputs({ attendance }))
    const hourly = 700 / 8
    expect(slip.earnings.restDayPay).toBe(r(700 * 1.3))
    expect(slip.earnings.overtimePay).toBe(r(2 * hourly * 1.25))
    expect(slip.days.lateUndertimeMinutes).toBe(30)
    expect(slip.deductions.lateUndertime).toBe(r(30 * (hourly / 60)))
    expect(slip.days.daysWorked).toBe(13)
  })

  it('pays paid leave like a worked day and skips unpaid leave', () => {
    const attendance = fullAttendance('2026-06-01', '2026-06-15', [june12]).filter((a) => a.date !== '2026-06-02' && a.date !== '2026-06-03')
    const leaves: LeaveRecord[] = [
      { ...base, id: 'l1', employeeId: 'e1', typeId: 'sick', dateFrom: '2026-06-02', dateTo: '2026-06-02' },
      { ...base, id: 'l2', employeeId: 'e1', typeId: 'unpaid', dateFrom: '2026-06-03', dateTo: '2026-06-03' },
    ]
    const slip = computePayslip(inputs({ attendance, leaves }))
    expect(slip.days.paidLeaveDays).toBe(1)
    expect(slip.days.unpaidLeaveDays).toBe(1)
    expect(slip.days.daysAbsent).toBe(0)
    expect(slip.earnings.basicPay).toBe(11 * 700) // 10 worked + 1 paid leave
  })

  it('pays night differential and cross-midnight OT on a night shift', () => {
    const attendance = [att('2026-06-01', { timeIn: '22:00', timeOut: '08:00' })] // 2h past 06:00 end
    const slip = computePayslip(inputs({ shift: nightShift, attendance, periodStart: '2026-06-01', periodEnd: '2026-06-01' }))
    const hourly = 700 / 8
    expect(slip.days.nightDiffHours).toBe(8)
    expect(slip.earnings.nightDiffPay).toBe(r(8 * hourly * 0.1))
    expect(slip.earnings.overtimePay).toBe(r(2 * hourly * 1.25))
  })

  it('respects statutory toggles', () => {
    const employee = emp({ statutory: { sss: false, philhealth: false, pagibig: false, withholdingTax: false } })
    const slip = computePayslip(inputs({ employee }))
    expect(slip.deductions.sss + slip.deductions.philhealth + slip.deductions.pagibig + slip.deductions.withholdingTax).toBe(0)
  })
})

describe('computePayslip - monthly rate', () => {
  const inputs = (attendance: AttendanceRecord[]) => ({
    employee: emp({ rateType: 'monthly' as const, baseRate: 26_000 }),
    config: cfg,
    shift: dayShift,
    holidays: [june12],
    attendance,
    leaves: [],
    sales: [],
    periodStart: '2026-06-01',
    periodEnd: '2026-06-15',
    paySchedule: 'semi_monthly' as const,
  })

  it('pays a fixed half-month; unworked holidays add nothing; absences deduct a derived daily rate', () => {
    const daily = 26_000 / 26 // 1,000
    const full = computePayslip(inputs(fullAttendance('2026-06-01', '2026-06-15', [june12])))
    expect(full.earnings.basicPay).toBe(13_000)
    expect(full.earnings.holidayPay).toBe(0)
    expect(full.deductions.absences).toBe(0)

    const oneAbsent = computePayslip(inputs(
      fullAttendance('2026-06-01', '2026-06-15', [june12]).filter((a) => a.date !== '2026-06-03'),
    ))
    expect(oneAbsent.earnings.basicPay).toBe(13_000)
    expect(oneAbsent.deductions.absences).toBe(daily)
    // SSS 26,000 → 1,300/mo → 650; PhilHealth 650/mo → 325; Pag-IBIG 200 → 100
    expect(oneAbsent.deductions.sss).toBe(650)
    expect(oneAbsent.taxableIncome).toBe(r(13_000 - daily - 650 - 325 - 100))
    expect(oneAbsent.deductions.withholdingTax).toBe(r((13_000 - daily - 650 - 325 - 100 - 10_417) * 0.15))
  })

  it('worked regular holiday pays only the premium over the covered 100%', () => {
    const attendance = [...fullAttendance('2026-06-01', '2026-06-15', [june12]), att('2026-06-12')]
    const slip = computePayslip(inputs(attendance))
    expect(slip.earnings.holidayPay).toBe(1_000) // (200% − 100%) × ₱1,000
    expect(slip.days.regularHolidayHours).toBe(8)
  })
})

describe('editing & reports', () => {
  it('recomputeTax honors non-taxable bonus lines', () => {
    const slip = computePayslip({
      employee: emp({}), config: cfg, shift: dayShift, holidays: [], leaves: [], sales: [],
      attendance: fullAttendance('2026-06-01', '2026-06-13'),
      periodStart: '2026-06-01', periodEnd: '2026-06-13', paySchedule: 'semi_monthly',
    })
    const taxableBefore = slip.taxableIncome
    slip.earnings.bonus = 5_000
    slip.earnings.bonusTaxable = false
    recomputeTax(slip, cfg, 'semi_monthly', true)
    expect(slip.taxableIncome).toBe(taxableBefore)
    expect(slip.grossPay).toBeGreaterThan(5_000)
  })

  it('13th month = YTD finalized basic / 12', () => {
    const mkSlip = (basicPay: number): Payslip =>
      ({ ...computePayslip({ employee: emp({}), config: cfg, shift: dayShift, holidays: [], attendance: [], leaves: [], sales: [], periodStart: '2026-06-01', periodEnd: '2026-06-15', paySchedule: 'semi_monthly' }), earnings: { ...computePayslip({ employee: emp({}), config: cfg, shift: dayShift, holidays: [], attendance: [], leaves: [], sales: [], periodStart: '2026-06-01', periodEnd: '2026-06-15', paySchedule: 'semi_monthly' }).earnings, basicPay } })
    const runs = [
      { periodStart: '2026-05-01', status: 'finalized', payslips: [mkSlip(10_000)] },
      { periodStart: '2026-06-01', status: 'finalized', payslips: [mkSlip(12_000)] },
      { periodStart: '2026-06-16', status: 'draft', payslips: [mkSlip(99_000)] },
      { periodStart: '2025-12-01', status: 'finalized', payslips: [mkSlip(50_000)] },
    ]
    const report = thirteenthMonth(runs, 2026)
    expect(report).toHaveLength(1)
    expect(report[0].basicEarned).toBe(22_000)
    expect(report[0].amount).toBe(r(22_000 / 12))
    expect(thirteenthMonth(runs, 2026, true)[0].basicEarned).toBe(121_000)
  })

  it('suggests the last completed cutoff per schedule', () => {
    expect(suggestCutoff('semi_monthly', '2026-07-19')).toEqual({ periodStart: '2026-07-01', periodEnd: '2026-07-15' })
    expect(suggestCutoff('semi_monthly', '2026-07-10')).toEqual({ periodStart: '2026-06-16', periodEnd: '2026-06-30' })
    expect(suggestCutoff('monthly', '2026-07-19')).toEqual({ periodStart: '2026-06-01', periodEnd: '2026-06-30' })
    expect(suggestCutoff('weekly', '2026-07-19')).toEqual({ periodStart: '2026-07-06', periodEnd: '2026-07-12' })
    expect(suggestCutoff('semi_monthly', '2026-01-05')).toEqual({ periodStart: '2025-12-16', periodEnd: '2025-12-31' })
  })
})
