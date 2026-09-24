import { describe, expect, it } from 'vitest'
import { bansFor } from './logistics'
import {
  DEFAULT_NUMBER_CODING, builtInRules, codingWeekdayFor, isHeavyTruck, numberCodingSettings,
} from './numberCoding'

// The rules as they stand with the fuel exemption switched off - what a
// non-fuel fleet, or this fleet the day the resolution is revoked, sees.
const RULES = { ...DEFAULT_NUMBER_CODING, fuelTankersExempt: false }
const withValue = (value: object) => numberCodingSettings([{ id: 'x', createdAt: '', updatedAt: '', key: 'numberCoding', value: { fuelTankersExempt: false, ...value } }])

// A Tuesday and a Wednesday in Manila time (the test runner pins TZ).
const TUE_8AM = '2026-09-15T08:00:00+08:00'
const TUE_NOON = '2026-09-15T12:00:00+08:00'
const WED_8AM = '2026-09-16T08:00:00+08:00'
const SAT_7AM = '2026-09-19T07:00:00+08:00'

describe('number coding', () => {
  it('reads the coding day off the last plate digit', () => {
    expect(codingWeekdayFor('ABC 1234')).toBe(2) // 4 -> Tuesday
    expect(codingWeekdayFor('NDX 5670')).toBe(5) // 0 -> Friday
    expect(codingWeekdayFor('XYZ')).toBeNull()
  })

  it('flags a coded plate inside the window and not outside it', () => {
    const rules = builtInRules(RULES)
    expect(bansFor(rules, 'ABC 1234', TUE_8AM).some((r) => r.builtin === 'mmdaCoding')).toBe(true)
    expect(bansFor(rules, 'ABC 1234', TUE_NOON).some((r) => r.builtin === 'mmdaCoding')).toBe(false)
    expect(bansFor(rules, 'ABC 1234', WED_8AM).some((r) => r.builtin === 'mmdaCoding')).toBe(false)
  })

  /** Both coding and the truck ban stand down on holidays. */
  it('stands coding and the truck ban down on a holiday', () => {
    const rules = builtInRules(RULES)
    const hits = bansFor(rules, 'ABC 1234', TUE_8AM, { holidays: ['2026-09-15'] })
    expect(hits.some((r) => r.builtin === 'mmdaCoding')).toBe(false)
    expect(hits.some((r) => r.builtin === 'mmdaTruckBan')).toBe(false)
    expect(bansFor(rules, 'ABC 1234', TUE_8AM).some((r) => r.builtin === 'mmdaTruckBan')).toBe(true)
  })

  /** The truck ban is by weight: a light van is clear, an unweighed truck is not. */
  it('applies the truck ban only to heavy trucks, treating unknown weight as heavy', () => {
    const rules = builtInRules(RULES)
    expect(isHeavyTruck({ gvwKg: undefined })).toBe(true)
    expect(isHeavyTruck({ gvwKg: 3500 })).toBe(false)
    expect(bansFor(rules, 'ABC 1235', SAT_7AM, { heavy: false }).some((r) => r.builtin === 'mmdaTruckBan')).toBe(false)
    expect(bansFor(rules, 'ABC 1235', SAT_7AM).some((r) => r.builtin === 'mmdaTruckBan')).toBe(true)
    // Saturday: no coding, only the truck ban.
    expect(bansFor(rules, 'ABC 1235', SAT_7AM).some((r) => r.builtin === 'mmdaCoding')).toBe(false)
  })

  /** The MMC resolution of 24 March 2026 lifts coding and the truck ban for
   *  fuel tankers alike, and it is in force, so a fresh install applies nothing. */
  it('applies no rule at all while the fuel exemption is on, which is the default', () => {
    expect(DEFAULT_NUMBER_CODING.fuelTankersExempt).toBe(true)
    expect(builtInRules(DEFAULT_NUMBER_CODING)).toEqual([])
    expect(builtInRules(RULES).length).toBeGreaterThan(0)
  })

  it('drops presets when switched off, and adds the city ones when asked', () => {
    const off = withValue({ enabled: { mmdaCoding: false } })
    expect(builtInRules(off).some((r) => r.builtin === 'mmdaCoding')).toBe(false)
    // Makati coding is off by default and on when asked.
    expect(builtInRules(RULES).some((r) => r.builtin === 'makatiCoding')).toBe(false)
    const makati = withValue({ enabled: { makatiCoding: true } })
    expect(bansFor(builtInRules(makati), 'ABC 1234', TUE_NOON).some((r) => r.builtin === 'makatiCoding')).toBe(true)
    // The city truck bans likewise: Makati's runs through the day, for a
    // trip whose planned route enters the CBD.
    expect(builtInRules(RULES).some((r) => r.builtin === 'makatiTruckBan')).toBe(false)
    const makatiBan = withValue({ enabled: { makatiTruckBan: true } })
    expect(bansFor(builtInRules(makatiBan), 'ABC 1235', TUE_NOON, { zones: ['makatiCbd'] }).some((r) => r.builtin === 'makatiTruckBan')).toBe(true)
  })

  /** The light-truck ban is the mirror of the truck ban: it catches a light
   *  six-tyre truck on EDSA in daytime and leaves a heavy one to the other rule. */
  it('applies the light-truck ban to light trucks only', () => {
    const rules = builtInRules(withValue({ enabled: { mmdaLightTruckBan: true } }))
    const onEdsa = { zones: ['edsa'] }
    expect(bansFor(rules, 'ABC 1235', TUE_NOON, { heavy: false, ...onEdsa }).some((r) => r.builtin === 'mmdaLightTruckBan')).toBe(true)
    expect(bansFor(rules, 'ABC 1235', TUE_NOON, onEdsa).some((r) => r.builtin === 'mmdaLightTruckBan')).toBe(false)
  })
})
