import { fmtCurrency } from './format'
import type { Block, Cell } from './printDoc'
import type { PayrollRun, Payslip } from '../data/types'

/**
 * The printable payslip - Exhibit A 1.7 ("printable payslips") and 1.9 ("each
 * form, slip, receipt and checklist … generated from its System record as a
 * printable and downloadable PDF").
 *
 * Payroll previously printed by calling `window.print()` on the whole screen,
 * which puts the app's navigation, filters and every other employee's pay on the
 * page. A payslip is handed to one person; it must contain that person's figures
 * and nothing else. This builds one document per employee through the same
 * `printDoc` pipeline every other System document uses, so the letterhead,
 * footer and paper size all match.
 *
 * ## Every line is shown, including the zeroes that matter
 *
 * Statutory deductions are printed even when zero. An employee exempted from SSS
 * needs to see "SSS - 0.00" rather than a missing row: a line that is absent
 * looks like an oversight, and the commonest payslip dispute is "why was I
 * deducted for X" closely followed by "why wasn't I". Earnings that are zero are
 * omitted, because listing every possible allowance an employee does not receive
 * is noise rather than reassurance.
 */

const money = (n: number) => fmtCurrency(n)

/** A row that is always shown, zero or not. */
const always = (label: string, amount: number): Cell => ({ label, value: money(amount) })

/** Peso rows that only earn their place when non-zero. */
function whenAny(entries: Array<[string, number]>): Cell[] {
  return entries.filter(([, v]) => v !== 0).map(([l, v]) => always(l, v))
}

/** Count rows - hours, days, minutes. Formatted as plain numbers: money() would
 * print "₱8.00" for eight hours of overtime. */
function counts(entries: Array<[string, number]>): Cell[] {
  return entries.filter(([, v]) => v !== 0).map(([label, v]) => ({ label, value: String(v) }))
}

export function payslipBlocks(slip: Payslip, run: Pick<PayrollRun, 'periodStart' | 'periodEnd' | 'paySchedule'>): Block[] {
  const e = slip.earnings
  const d = slip.deductions

  const earnings: Cell[] = [
    always('Basic pay', e.basicPay),
    ...whenAny([
      ['Overtime', e.overtimePay],
      ['Night differential', e.nightDiffPay],
      ['Rest day pay', e.restDayPay],
      ['Holiday pay', e.holidayPay],
      ['Allowance', e.allowance],
      ['Commission', e.commission],
      ['Bonus', e.bonus],
      ['Incentive', e.incentive],
    ]),
    ...e.otherEarnings.filter((l) => l.amount !== 0).map((l) => always(l.label, l.amount)),
  ]

  const deductions: Cell[] = [
    // Statutory lines are always printed - see the note above.
    always('SSS', d.sss),
    always('PhilHealth', d.philhealth),
    always('Pag-IBIG', d.pagibig),
    always('Withholding tax', d.withholdingTax),
    ...whenAny([
      ['Late / undertime', d.lateUndertime],
      ['Absences', d.absences],
    ]),
    ...d.otherDeductions.filter((l) => l.amount !== 0).map((l) => always(l.label, l.amount)),
  ]

  const days = slip.days

  // The hour counts behind the money. An employee querying overtime wants the
  // hours, not just the peso figure they already disagree with.
  const hourRows = counts([
    ['Days worked', days.daysWorked],
    ['Days absent', days.daysAbsent],
    ['Paid leave (days)', days.paidLeaveDays],
    ['Unpaid leave (days)', days.unpaidLeaveDays],
    ['Overtime (hours)', days.regularOtHours],
    ['Rest day (hours)', days.restDayHours],
    ['Rest day OT (hours)', days.restDayOtHours],
    ['Special day (hours)', days.specialDayHours],
    ['Special day OT (hours)', days.specialDayOtHours],
    ['Regular holiday (hours)', days.regularHolidayHours],
    ['Regular holiday OT (hours)', days.regularHolidayOtHours],
    ['Night differential (hours)', days.nightDiffHours],
    ['Late / undertime (minutes)', days.lateUndertimeMinutes],
    ['Unworked regular holidays', days.unworkedRegularHolidays],
  ])

  return [
    {
      kind: 'fields',
      cells: [
        { label: 'Employee', value: slip.employeeName },
        { label: 'Role', value: slip.role },
        { label: 'Pay period', value: `${run.periodStart} to ${run.periodEnd}` },
        { label: 'Pay schedule', value: run.paySchedule.replace(/_/g, ' ') },
        { label: 'Rate', value: `${money(slip.baseRate)} ${slip.rateType === 'daily' ? 'per day' : 'per month'}` },
        { label: 'Days worked', value: String(days.daysWorked) },
      ],
    },
    { kind: 'fields', heading: 'Earnings', cells: earnings },
    { kind: 'fields', heading: 'Deductions', cells: deductions },
    {
      kind: 'fields',
      heading: 'Summary',
      columns: 1,
      cells: [
        always('Gross pay', slip.grossPay),
        always('Taxable income', slip.taxableIncome),
        always('Total deductions', slip.totalDeductions),
        always('NET PAY', slip.netPay),
      ],
    },
    ...(hourRows.length > 0 ? [{
      kind: 'fields' as const,
      heading: 'Hours and days',
      cells: hourRows,
    }] : []),
    ...(slip.notes ? [{ kind: 'note' as const, text: slip.notes }] : []),
    {
      kind: 'signatures',
      signatories: [
        { role: 'Received by', name: slip.employeeName },
        { role: 'Released by' },
      ],
    },
  ]
}

export const payslipMeta = (slip: Payslip, run: Pick<PayrollRun, 'periodEnd'>) => ({
  title: 'Payslip',
  referenceNo: `${slip.employeeName} - ${run.periodEnd}`,
  date: run.periodEnd,
})
