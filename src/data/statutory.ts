// Official PH payroll constants, seeded as editable defaults.
// Everything here is *data*, not law baked into code: HR → Setup edits the live
// copies (stored in the hrSettings record), and "Restore official values" puts
// these back. Sources, as of 2026:
//   SSS:        RA 11199 schedule in effect since Jan 2025 - 15% of MSC
//               (5% employee / 10% employer), MSC ₱5,000–₱35,000, MPF above ₱20,000.
//   PhilHealth: 5% of basic monthly salary, split equally, floor ₱10,000 / cap ₱100,000.
//   Pag-IBIG:   2% employee + 2% employer on a max fund salary of ₱10,000 (₱200 EE cap).
//   BIR:        Revised withholding tables under TRAIN, effective Jan 2023 (unchanged).
//   Premiums:   DOLE handbook multipliers (OT, rest day, holidays, night diff).
//   Holidays:   Proclamation No. 1006 (2026 list).

import type {
  Base, Holiday, HolidayKind, HrConfig, LeaveType, PagibigTable, PhilhealthTable,
  PremiumRates, SssTable, WithholdingTables,
} from './types'

export const OFFICIAL_SSS: SssTable = {
  eeRate: 0.05,
  erRate: 0.10,
  minMsc: 5_000,
  maxMsc: 35_000,
  step: 500,
  mpfThresholdMsc: 20_000,
}

export const OFFICIAL_PHILHEALTH: PhilhealthTable = {
  rate: 0.05,
  floor: 10_000,
  ceiling: 100_000,
  eeShare: 0.5,
}

export const OFFICIAL_PAGIBIG: PagibigTable = {
  eeRate: 0.02,
  erRate: 0.02,
  maxFundSalary: 10_000,
}

/** BIR RR 11-2018 Annex E, "effective January 1, 2023 and onwards". */
export const OFFICIAL_WITHHOLDING: WithholdingTables = {
  daily: [
    { over: 0, baseTax: 0, rate: 0 },
    { over: 685, baseTax: 0, rate: 0.15 },
    { over: 1_096, baseTax: 61.65, rate: 0.20 },
    { over: 2_192, baseTax: 280.85, rate: 0.25 },
    { over: 5_479, baseTax: 1_102.60, rate: 0.30 },
    { over: 21_918, baseTax: 6_034.30, rate: 0.35 },
  ],
  weekly: [
    { over: 0, baseTax: 0, rate: 0 },
    { over: 4_808, baseTax: 0, rate: 0.15 },
    { over: 7_692, baseTax: 432.60, rate: 0.20 },
    { over: 15_385, baseTax: 1_971.20, rate: 0.25 },
    { over: 38_462, baseTax: 7_740.45, rate: 0.30 },
    { over: 153_846, baseTax: 42_355.65, rate: 0.35 },
  ],
  semi_monthly: [
    { over: 0, baseTax: 0, rate: 0 },
    { over: 10_417, baseTax: 0, rate: 0.15 },
    { over: 16_667, baseTax: 937.50, rate: 0.20 },
    { over: 33_333, baseTax: 4_270.70, rate: 0.25 },
    { over: 83_333, baseTax: 16_770.70, rate: 0.30 },
    { over: 333_333, baseTax: 91_770.70, rate: 0.35 },
  ],
  monthly: [
    { over: 0, baseTax: 0, rate: 0 },
    { over: 20_833, baseTax: 0, rate: 0.15 },
    { over: 33_333, baseTax: 1_875.00, rate: 0.20 },
    { over: 66_667, baseTax: 8_541.80, rate: 0.25 },
    { over: 166_667, baseTax: 33_541.80, rate: 0.30 },
    { over: 666_667, baseTax: 183_541.80, rate: 0.35 },
  ],
}

/** DOLE multipliers. First-8h premiums multiply the daily rate; OT multiplies hourly. */
export const OFFICIAL_PREMIUMS: PremiumRates = {
  ordinaryOt: 1.25,
  restDay: 1.30,
  restDayOt: 1.69,
  specialDay: 1.30,
  specialDayOt: 1.69,
  specialRestDay: 1.50,
  specialRestDayOt: 1.95,
  regularHoliday: 2.00,
  regularHolidayOt: 2.60,
  regularHolidayRestDay: 2.60,
  regularHolidayRestDayOt: 3.38,
  nightDiff: 0.10,
}

export const DEFAULT_LEAVE_TYPES: LeaveType[] = [
  { id: 'sil', label: 'Service Incentive Leave', paid: true },
  { id: 'vacation', label: 'Vacation', paid: true },
  { id: 'sick', label: 'Sick', paid: true },
  { id: 'unpaid', label: 'Unpaid', paid: false },
]

export const DEFAULT_HR_CONFIG: HrConfig = {
  defaultPaySchedule: 'semi_monthly',
  workdayHours: 8,
  monthlyWorkDays: 26,
  statutoryDefaults: { sss: true, philhealth: true, pagibig: true, withholdingTax: true },
  leaveTypes: DEFAULT_LEAVE_TYPES,
  premiumRates: OFFICIAL_PREMIUMS,
  sss: OFFICIAL_SSS,
  philhealth: OFFICIAL_PHILHEALTH,
  pagibig: OFFICIAL_PAGIBIG,
  withholding: OFFICIAL_WITHHOLDING,
}

/** Deep-ish merge of a stored (possibly older/partial) config over the defaults, so
 * adding a config field later never breaks an existing installation. */
export function mergeHrConfig(stored: Partial<HrConfig> | undefined): HrConfig {
  if (!stored) return DEFAULT_HR_CONFIG
  return {
    ...DEFAULT_HR_CONFIG,
    ...stored,
    statutoryDefaults: { ...DEFAULT_HR_CONFIG.statutoryDefaults, ...stored.statutoryDefaults },
    premiumRates: { ...DEFAULT_HR_CONFIG.premiumRates, ...stored.premiumRates },
    sss: { ...DEFAULT_HR_CONFIG.sss, ...stored.sss },
    philhealth: { ...DEFAULT_HR_CONFIG.philhealth, ...stored.philhealth },
    pagibig: { ...DEFAULT_HR_CONFIG.pagibig, ...stored.pagibig },
    withholding: { ...DEFAULT_HR_CONFIG.withholding, ...stored.withholding },
    leaveTypes: stored.leaveTypes ?? DEFAULT_HR_CONFIG.leaveTypes,
  }
}

/** 2026 national holidays per Proclamation No. 1006. Eid'l Fitr and Eid'l Adha are
 * proclaimed separately once their dates are known - HR adds them in Setup. */
export const HOLIDAYS_2026: Omit<Holiday, keyof Base>[] = ([
  ['2026-01-01', "New Year's Day", 'regular'],
  ['2026-02-17', 'Chinese New Year', 'special_nonworking'],
  ['2026-02-25', 'EDSA People Power Anniversary', 'special_working'],
  ['2026-04-02', 'Maundy Thursday', 'regular'],
  ['2026-04-03', 'Good Friday', 'regular'],
  ['2026-04-04', 'Black Saturday', 'special_nonworking'],
  ['2026-04-09', 'Araw ng Kagitingan', 'regular'],
  ['2026-05-01', 'Labor Day', 'regular'],
  ['2026-06-12', 'Independence Day', 'regular'],
  ['2026-08-21', 'Ninoy Aquino Day', 'special_nonworking'],
  ['2026-08-31', 'National Heroes Day', 'regular'],
  ['2026-11-01', "All Saints' Day", 'special_nonworking'],
  ['2026-11-02', "All Souls' Day", 'special_nonworking'],
  ['2026-11-30', 'Bonifacio Day', 'regular'],
  ['2026-12-08', 'Feast of the Immaculate Conception', 'special_nonworking'],
  ['2026-12-24', 'Christmas Eve', 'special_nonworking'],
  ['2026-12-25', 'Christmas Day', 'regular'],
  ['2026-12-30', 'Rizal Day', 'regular'],
  ['2026-12-31', 'Last Day of the Year', 'special_nonworking'],
] as [string, string, HolidayKind][]).map(([date, name, kind]) => ({ date, name, kind }))
