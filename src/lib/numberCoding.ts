import type { AppSetting, Truck, TruckBanRule } from '../data/types'
import type { ZoneKey } from './zones'

/**
 * The traffic regulations the app knows on its own, so a dispatcher is warned
 * about a coded plate or a banned truck without an administrator first typing
 * the MMDA's schedule into the rules table.
 *
 * Two different laws, easy to conflate:
 *
 * **Number coding (UVVRP, MMDA Regulation 96-005 as amended).** By the last
 * digit of the plate, weekdays only, and lifted on holidays. Metro Manila-wide
 * on 7-10am and 5-8pm; Makati runs its own ordinance through the day with no
 * window. Tollways are exempt. A truck is caught by this like any other
 * vehicle unless MMDA has granted it an exemption.
 *
 * **The truck ban (MMDA Regulation 96-002 series and the LGU ordinances that
 * mirror it).** By weight, not plate: vehicles over 4,500 kg gross, Monday to
 * Saturday, 6-10am and 5-10pm on the major routes, all day on EDSA and Roxas
 * Boulevard. Like coding, it stands down on Sundays and holidays. The cities
 * run their own, stricter, versions - Makati's business district all day,
 * Parañaque's on its own clock, Manila's from the 2014 port crisis - and a
 * separate light-truck ban keeps six-tyre vehicles under the weight line off
 * EDSA and Shaw in daytime. Those ship switched off: they only matter to a
 * trip that goes through that city, which the rules cannot yet tell.
 *
 * **The fuel exemption.** On 24 March 2026 the Metro Manila Council exempted
 * oil tankers and vehicles carrying basic commodities from both the truck ban
 * and number coding, for the duration of the fuel-price emergency, with no
 * end date published. For a fuel hauler that lifts every Metro Manila rule
 * above at once. It is on by default, because it is in force; it carries a
 * re-check date, because a resolution with no sunset is exactly the kind of
 * thing that gets quietly revoked.
 *
 * Everything here is a fact about the outside world that changes by
 * resolution, so it carries a date and a source and is meant to be re-checked.
 * The generated rules are ordinary TruckBanRule rows as far as the matcher is
 * concerned (lib/logistics.ts banApplies), which is what lets them share the
 * clash list and the trip drawer's warning with the rules typed by hand.
 */

/** When these schedules were last checked against the authorities' notices. */
export const CODING_RULES_AS_OF = '2026-09-19'

/**
 * The fuel exemption, as a fact with a date on it. `recheckBy` is when
 * somebody should look again whether the resolution still stands; past it,
 * the app says so wherever the exemption is relied on.
 */
export const FUEL_EXEMPTION = {
  title: 'Fuel tankers exempt from number coding and the truck ban',
  source: 'Metro Manila Council resolution of 24 March 2026, on fuel and basic-commodity deliveries',
  since: '2026-03-24',
  recheckBy: '2026-12-31',
}

export const fuelExemptionStale = (today = new Date()): boolean =>
  today.toISOString().slice(0, 10) > FUEL_EXEMPTION.recheckBy

/** The truck ban's weight line: gross vehicle weight above this is a truck. */
export const TRUCK_BAN_GVW_KG = 4500

/**
 * UVVRP: which last digits are coded on which weekday (0 = Sunday).
 * Saturday and Sunday are free.
 */
export const CODING_DIGITS: Record<number, string[]> = {
  1: ['1', '2'],
  2: ['3', '4'],
  3: ['5', '6'],
  4: ['7', '8'],
  5: ['9', '0'],
}

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** The last digit of a plate, or null for a plate with no digit in it. */
export function plateLastDigit(plateNumber: string): string | null {
  const digits = plateNumber.replace(/[^0-9]/g, '')
  return digits ? digits.slice(-1) : null
}

/** The weekday a plate is coded on under UVVRP, or null when it cannot be told. */
export function codingWeekdayFor(plateNumber: string): number | null {
  const last = plateLastDigit(plateNumber)
  if (last === null) return null
  const day = Object.entries(CODING_DIGITS).find(([, digits]) => digits.includes(last))
  return day ? Number(day[0]) : null
}

/** Whether a truck is on the heavy side of the truck-ban line. Unknown weight
 *  counts as heavy - see Truck.gvwKg. */
export const isHeavyTruck = (truck: Pick<Truck, 'gvwKg'>): boolean =>
  truck.gvwKg === undefined || truck.gvwKg === null || truck.gvwKg > TRUCK_BAN_GVW_KG

// ---- presets ----------------------------------------------------------------

export type PresetKey = 'mmdaCoding' | 'makatiCoding' | 'mmdaTruckBan' | 'mmdaLightTruckBan' | 'makatiTruckBan' | 'paranaqueTruckBan' | 'manilaTruckBan'

export interface Preset {
  key: PresetKey
  title: string
  authority: string
  area: string
  /** One line for the settings card. */
  summary: string
  source: string
  /** Blank means the same rule for every plate (a truck ban). */
  byPlate: boolean
  appliesTo: 'all' | 'heavy' | 'light'
  /** Number coding or a truck ban - the fuel exemption lifts both, but the
   *  settings card groups them apart. */
  kind: 'coding' | 'ban'
  /** Something the administrator should know before switching it on. */
  caveat?: string
  /** Confined to trips whose planned route enters this zone (lib/zones.ts). */
  zone?: ZoneKey
  suspendedOnHolidays: boolean
  weekdays: number[]
  windows: { start: string; end: string }[]
}

export const PRESETS: Preset[] = [
  {
    key: 'mmdaCoding',
    title: 'Number coding (MMDA)',
    authority: 'MMDA',
    area: 'Metro Manila',
    summary: 'Mon–Fri 7:00–10:00 and 17:00–20:00 by last plate digit; lifted on holidays; tollways exempt.',
    source: 'MMDA Regulation 96-005 (UVVRP), as amended',
    kind: 'coding',
    byPlate: true,
    appliesTo: 'all',
    suspendedOnHolidays: true,
    weekdays: [1, 2, 3, 4, 5],
    windows: [{ start: '07:00', end: '10:00' }, { start: '17:00', end: '20:00' }],
  },
  {
    key: 'makatiCoding',
    title: 'Number coding (Makati)',
    authority: 'Makati City',
    area: 'Makati city streets',
    summary: 'Mon–Fri 7:00–19:00 with no window; same digits as MMDA.',
    source: 'Makati City ordinance on the UVVRP',
    kind: 'coding',
    byPlate: true,
    appliesTo: 'all',
    suspendedOnHolidays: true,
    weekdays: [1, 2, 3, 4, 5],
    windows: [{ start: '07:00', end: '19:00' }],
  },
  {
    key: 'mmdaTruckBan',
    title: 'Truck ban (MMDA)',
    authority: 'MMDA',
    area: 'Major Metro Manila routes; EDSA and Roxas Blvd all day',
    summary: `Mon–Sat 6:00–10:00 and 17:00–22:00 for trucks over ${TRUCK_BAN_GVW_KG.toLocaleString()} kg GVW; lifted on Sundays and holidays.`,
    source: 'MMDA truck ban regulation and LGU ordinances',
    kind: 'ban',
    byPlate: false,
    appliesTo: 'heavy',
    suspendedOnHolidays: true,
    weekdays: [1, 2, 3, 4, 5, 6],
    windows: [{ start: '06:00', end: '10:00' }, { start: '17:00', end: '22:00' }],
  },
  {
    key: 'mmdaLightTruckBan',
    title: 'Light-truck ban (MMDA)',
    authority: 'MMDA',
    area: 'EDSA, Magallanes to North Ave; Shaw Blvd',
    summary: `Mon–Sat 5:00–21:00 on EDSA (Shaw Blvd 6:00–10:00 and 17:00–22:00) for six-tyre vehicles at or under ${TRUCK_BAN_GVW_KG.toLocaleString()} kg GVW.`,
    source: 'MMDA Uniform Light Truck Ban',
    kind: 'ban',
    byPlate: false,
    appliesTo: 'light',
    suspendedOnHolidays: true,
    weekdays: [1, 2, 3, 4, 5, 6],
    windows: [{ start: '05:00', end: '21:00' }],
    zone: 'edsa',
    caveat: 'Checked against the planned route; only fires for a light truck whose route runs along EDSA.',
  },
  {
    key: 'makatiTruckBan',
    title: 'Truck ban (Makati)',
    authority: 'Makati City',
    area: 'Makati central business district',
    summary: `Mon–Sat 6:00–22:00, all day, for trucks over ${TRUCK_BAN_GVW_KG.toLocaleString()} kg GVW.`,
    source: 'Makati City truck ban ordinance',
    kind: 'ban',
    byPlate: false,
    appliesTo: 'heavy',
    suspendedOnHolidays: true,
    weekdays: [1, 2, 3, 4, 5, 6],
    windows: [{ start: '06:00', end: '22:00' }],
    zone: 'makatiCbd',
    caveat: 'Checked against the planned route: fires only when it enters the Makati CBD.',
  },
  {
    key: 'paranaqueTruckBan',
    title: 'Truck ban (Parañaque)',
    authority: 'Parañaque City',
    area: 'Parañaque city roads',
    summary: `Mon–Sat 6:00–9:00 and 16:00–20:00 for trucks over ${TRUCK_BAN_GVW_KG.toLocaleString()} kg GVW.`,
    source: 'Parañaque City truck ban ordinance',
    kind: 'ban',
    byPlate: false,
    appliesTo: 'heavy',
    suspendedOnHolidays: true,
    weekdays: [1, 2, 3, 4, 5, 6],
    windows: [{ start: '06:00', end: '09:00' }, { start: '16:00', end: '20:00' }],
    zone: 'paranaque',
    caveat: 'Checked against the planned route: fires only when it passes through Parañaque.',
  },
  {
    key: 'manilaTruckBan',
    title: 'Truck ban (City of Manila)',
    authority: 'City of Manila',
    area: 'Manila city streets',
    summary: `Mon–Sat 5:00–21:00 with a 10:00–15:00 window, for eight-wheelers and trucks over ${TRUCK_BAN_GVW_KG.toLocaleString()} kg GVW.`,
    source: 'Manila Ordinance 8092 (2014), as relaxed by the window period',
    kind: 'ban',
    byPlate: false,
    appliesTo: 'heavy',
    suspendedOnHolidays: true,
    weekdays: [1, 2, 3, 4, 5, 6],
    windows: [{ start: '05:00', end: '10:00' }, { start: '15:00', end: '21:00' }],
    zone: 'manila',
    caveat: 'The 2014 schedule - confirm the ordinance’s current form with the city. Checked against the planned route.',
  },
]

// ---- settings ---------------------------------------------------------------

export interface NumberCodingSettings {
  /** Which presets are switched on. Missing keys take the default. */
  enabled: Partial<Record<PresetKey, boolean>>
  /** Fuel tankers exempt from number coding and every truck ban, under the
   *  MMC resolution of 24 March 2026 (FUEL_EXEMPTION). On by default because
   *  it is in force; switched off the day it is revoked. */
  fuelTankersExempt: boolean
  /** The overloading check against RA 8794 (lib/vehicleLimits.ts). */
  overloadCheck: boolean
  /** The tollway class check - Skyway's elevated sections. */
  tollClassCheck: boolean
}

export const NUMBER_CODING_KEY = 'numberCoding'

export const DEFAULT_NUMBER_CODING: NumberCodingSettings = {
  enabled: { mmdaCoding: true, makatiCoding: false, mmdaTruckBan: true, mmdaLightTruckBan: false, makatiTruckBan: false, paranaqueTruckBan: false, manilaTruckBan: false },
  fuelTankersExempt: true,
  overloadCheck: true,
  tollClassCheck: true,
}

/** The live settings from the appSettings table, merged over the defaults so
 *  a fresh installation warns about the MMDA rules out of the box. */
export function numberCodingSettings(rows: AppSetting[] | undefined): NumberCodingSettings {
  const row = rows?.find((r) => r.key === NUMBER_CODING_KEY)
  const v = (row?.value ?? {}) as Partial<NumberCodingSettings>
  return {
    enabled: { ...DEFAULT_NUMBER_CODING.enabled, ...(v.enabled ?? {}) },
    fuelTankersExempt: v.fuelTankersExempt ?? DEFAULT_NUMBER_CODING.fuelTankersExempt,
    overloadCheck: v.overloadCheck ?? DEFAULT_NUMBER_CODING.overloadCheck,
    tollClassCheck: v.tollClassCheck ?? DEFAULT_NUMBER_CODING.tollClassCheck,
  }
}

export const isPresetOn = (s: NumberCodingSettings, key: PresetKey): boolean =>
  s.enabled[key] ?? DEFAULT_NUMBER_CODING.enabled[key] ?? false

// ---- generated rules --------------------------------------------------------

const stamp = { createdAt: '', updatedAt: '' }

/**
 * The enabled presets as rules the matcher already understands.
 *
 * A by-plate preset becomes one rule per coded weekday per window, each
 * carrying that day's two digits, so `banApplies` needs no new idea of "the
 * digit depends on the day". A truck ban becomes one rule per window with no
 * plate filter and `appliesTo: 'heavy'`. Every generated rule has a `builtin`
 * key, which is how the UI tells them from typed ones.
 */
export function builtInRules(settings: NumberCodingSettings): TruckBanRule[] {
  const out: TruckBanRule[] = []
  // The fuel exemption lifts number coding and the truck bans alike, for
  // the whole fleet - fuel tankers by definition.
  if (settings.fuelTankersExempt) return out
  for (const p of PRESETS) {
    if (!isPresetOn(settings, p.key)) continue
    const days = p.byPlate ? p.weekdays.filter((d) => CODING_DIGITS[d]) : [p.weekdays]
    for (const day of days) {
      const weekdays = Array.isArray(day) ? day : [day]
      const digits = p.byPlate && !Array.isArray(day) ? CODING_DIGITS[day] : []
      p.windows.forEach((w, i) => {
        out.push({
          ...stamp,
          id: `builtin:${p.key}:${weekdays.join('')}:${i}`,
          builtin: p.key,
          authority: p.authority,
          area: p.area,
          weekdays,
          startTime: w.start,
          endTime: w.end,
          plateEndsWith: digits,
          appliesTo: p.appliesTo,
          zone: p.zone,
          suspendedOnHolidays: p.suspendedOnHolidays,
          active: true,
        })
      })
    }
  }
  return out
}
