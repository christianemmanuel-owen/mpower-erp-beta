import {
  autoOtHours, lateUndertimeMins, nightHours, payrollDayShape,
} from '../../lib/payroll'
import type { AttendanceRecord, LeaveRecord, Shift } from '../../data/types'

/**
 * One employee's period, counted the way payroll will count it.
 *
 * Extracted because the period table and the per-employee drawer are the same
 * arithmetic at two zoom levels, and two copies of it would eventually disagree
 * about something like whether a half day is 0.5 present or 1.
 */
export interface PeriodTotals {
  present: number
  absent: number
  /** Encoded present but missing a stamp: payroll will pay this day as nothing.
   *  Not "absent" either - nobody said they were away - so it is counted apart
   *  rather than folded into a number that would hide the omission. */
  incomplete: number
  leaveDays: number
  ot: number
  night: number
  late: number
}

export function periodTotals(
  records: AttendanceRecord[],
  shift: Shift,
): PeriodTotals {
  const shapes = records.map((a) => ({ a, shape: payrollDayShape(a) }))
  return {
    present: shapes.filter((x) => x.shape === 'present').length
      + shapes.filter((x) => x.shape === 'half').length * 0.5,
    absent: records.filter((a) => a.status === 'absent').length,
    incomplete: shapes.filter((x) => x.a.status === 'present' && x.shape === 'not-worked').length,
    leaveDays: 0,
    ot: shapes.reduce((s, x) => s + (x.shape === 'present' ? (x.a.otHours ?? autoOtHours(x.a, shift)) : 0), 0),
    night: records.reduce((s, a) => s + nightHours(a), 0),
    late: records.reduce((s, a) => s + lateUndertimeMins(a, shift), 0),
  }
}

export const recordsInRange = (attendance: AttendanceRecord[], employeeId: string, from: string, to: string) =>
  attendance.filter((a) => a.employeeId === employeeId && a.date >= from && a.date <= to)

export const leavesInRange = (leaves: LeaveRecord[], employeeId: string, from: string, to: string) =>
  leaves.filter((l) => l.employeeId === employeeId && l.dateFrom <= to && l.dateTo >= from)
