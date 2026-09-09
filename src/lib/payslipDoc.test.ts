import { describe, expect, it } from 'vitest'
import { payslipBlocks, payslipMeta } from './payslipDoc'
import { renderDocument } from './printDoc'
import type { PayrollRun, Payslip } from '../data/types'

const run: Pick<PayrollRun, 'periodStart' | 'periodEnd' | 'paySchedule'> = {
  periodStart: '2026-08-01', periodEnd: '2026-08-15', paySchedule: 'semi_monthly',
}

const slip = (over: Partial<Payslip> = {}): Payslip => ({
  employeeId: 'e1',
  employeeName: 'Maria Santos',
  role: 'driver',
  rateType: 'daily',
  baseRate: 750,
  days: {
    daysWorked: 12, daysAbsent: 0, paidLeaveDays: 0, unpaidLeaveDays: 0,
    regularOtHours: 6, restDayHours: 0, restDayOtHours: 0,
    specialDayHours: 0, specialDayOtHours: 0,
    regularHolidayHours: 0, regularHolidayOtHours: 0,
    nightDiffHours: 0, lateUndertimeMinutes: 0, unworkedRegularHolidays: 0,
  },
  earnings: {
    basicPay: 9_000, overtimePay: 703.13, nightDiffPay: 0, restDayPay: 0, holidayPay: 0,
    allowance: 1_200, commission: 0, bonus: 0, bonusTaxable: true,
    incentive: 0, incentiveTaxable: true, otherEarnings: [],
  },
  deductions: {
    sss: 450, philhealth: 225, pagibig: 100, withholdingTax: 0,
    lateUndertime: 0, absences: 0, otherDeductions: [],
  },
  grossPay: 10_903.13,
  taxableIncome: 9_703.13,
  totalDeductions: 775,
  netPay: 10_128.13,
  ...over,
})

/** Flattens every printed label/value pair for assertion. */
const cellsOf = (blocks: ReturnType<typeof payslipBlocks>) =>
  blocks.flatMap((b) => (b.kind === 'fields' ? b.cells : []))
const labels = (blocks: ReturnType<typeof payslipBlocks>) => cellsOf(blocks).map((c) => c.label)
const valueOf = (blocks: ReturnType<typeof payslipBlocks>, label: string) =>
  cellsOf(blocks).find((c) => c.label === label)?.value

describe('payslipBlocks', () => {
  it('identifies the employee and the period the pay covers', () => {
    const b = payslipBlocks(slip(), run)
    expect(valueOf(b, 'Employee')).toBe('Maria Santos')
    expect(valueOf(b, 'Pay period')).toBe('2026-08-01 to 2026-08-15')
    expect(valueOf(b, 'Pay schedule')).toBe('semi monthly')
  })

  it('always prints every statutory deduction, including zeroes', () => {
    // A missing line looks like an oversight; "why wasn't I deducted for X" is
    // as common a dispute as "why was I".
    const b = payslipBlocks(slip(), run)
    for (const l of ['SSS', 'PhilHealth', 'Pag-IBIG', 'Withholding tax']) {
      expect(labels(b)).toContain(l)
    }
    expect(valueOf(b, 'Withholding tax')).toMatch(/0\.00/)
  })

  it('omits earnings the employee did not receive', () => {
    // Listing every allowance someone does not get is noise, not reassurance.
    const b = payslipBlocks(slip(), run)
    expect(labels(b)).not.toContain('Commission')
    expect(labels(b)).not.toContain('Bonus')
    expect(labels(b)).toContain('Allowance')
  })

  it('includes earnings once they are non-zero', () => {
    const b = payslipBlocks(slip({
      earnings: { ...slip().earnings, commission: 4_200 },
    }), run)
    expect(valueOf(b, 'Commission')).toMatch(/4,200/)
  })

  it('prints hours as counts, not as pesos', () => {
    // The bug this guards: money formatting turned 6 overtime hours into ₱6.00.
    const b = payslipBlocks(slip(), run)
    expect(valueOf(b, 'Overtime (hours)')).toBe('6')
    expect(valueOf(b, 'Overtime (hours)')).not.toMatch(/₱/)
  })

  it('keeps the peso overtime and the overtime hours as separate lines', () => {
    const b = payslipBlocks(slip(), run)
    expect(valueOf(b, 'Overtime')).toMatch(/703/)
    expect(valueOf(b, 'Overtime (hours)')).toBe('6')
  })

  it('drops the hours block entirely when there is nothing to show', () => {
    const empty = slip({
      days: { ...slip().days, daysWorked: 0, regularOtHours: 0 },
    })
    const b = payslipBlocks(empty, run)
    expect(b.some((x) => x.kind === 'fields' && x.heading === 'Hours and days')).toBe(false)
  })

  it('carries the net pay through to the summary', () => {
    const b = payslipBlocks(slip(), run)
    expect(valueOf(b, 'NET PAY')).toMatch(/10,128\.13/)
    expect(valueOf(b, 'Gross pay')).toMatch(/10,903\.13/)
  })

  it('includes custom earning and deduction lines', () => {
    const b = payslipBlocks(slip({
      earnings: { ...slip().earnings, otherEarnings: [{ label: 'Perfect attendance', amount: 500, taxable: true }] },
      deductions: { ...slip().deductions, otherDeductions: [{ label: 'Cash advance', amount: 1_000, taxable: false }] },
    }), run)
    expect(valueOf(b, 'Perfect attendance')).toMatch(/500/)
    expect(valueOf(b, 'Cash advance')).toMatch(/1,000/)
  })

  it('leaves out a custom line worth nothing', () => {
    const b = payslipBlocks(slip({
      deductions: { ...slip().deductions, otherDeductions: [{ label: 'Uniform', amount: 0, taxable: false }] },
    }), run)
    expect(labels(b)).not.toContain('Uniform')
  })

  it('ends with signature lines naming the employee', () => {
    const b = payslipBlocks(slip(), run)
    const sig = b.find((x) => x.kind === 'signatures')
    expect(sig).toBeTruthy()
    if (sig?.kind === 'signatures') {
      expect(sig.signatories.map((s) => s.name)).toContain('Maria Santos')
    }
  })

  it('prints a note when the payslip carries one', () => {
    const b = payslipBlocks(slip({ notes: 'Final pay - last day 15 Aug.' }), run)
    expect(b.some((x) => x.kind === 'note' && x.text.includes('Final pay'))).toBe(true)
  })
})

describe('the rendered document', () => {
  it('contains this employee and no one else', () => {
    // The old behaviour printed the whole screen, so every employee's pay went
    // onto the page handed to one person.
    const html = renderDocument(payslipMeta(slip(), run), payslipBlocks(slip(), run))
    expect(html).toContain('Maria Santos')
    expect(html).not.toContain('Juan Dela Cruz')
    expect(html).toContain('Payslip')
  })

  it('escapes a name that would otherwise inject markup', () => {
    const html = renderDocument(
      payslipMeta(slip({ employeeName: '<script>alert(1)</script>' }), run),
      payslipBlocks(slip({ employeeName: '<script>alert(1)</script>' }), run),
    )
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
  })
})
