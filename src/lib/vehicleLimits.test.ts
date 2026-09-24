import { describe, expect, it } from 'vitest'
import { loadCheck, tollProblems } from './vehicleLimits'
import { zonesCrossed } from './zones'
import { bansFor } from './logistics'
import { builtInRules, numberCodingSettings } from './numberCoding'

const withValue = (value: object) => numberCodingSettings([{ id: 'x', createdAt: '', updatedAt: '', key: 'numberCoding', value: { fuelTankersExempt: false, ...value } }])
const TUE_NOON = '2026-09-15T12:00:00+08:00'

describe('the truck itself', () => {
  /** 10,000 L of diesel on a 9-tonne two-axle truck is over the 18-tonne line. */
  it('flags an overload from empty weight plus litres, and stays quiet without the figures', () => {
    const over = loadCheck({ tareKg: 9_000, axleConfig: 'rigid2' }, 12_000)
    expect(over).toMatchObject({ ladenKg: 19_200, maxKg: 18_000, overKg: 1_200 })
    expect(loadCheck({ tareKg: 9_000, axleConfig: 'rigid2' }, 8_000)?.overKg).toBe(0)
    // A hand-typed legal weight wins over the axle code's.
    expect(loadCheck({ tareKg: 9_000, axleConfig: 'rigid2', maxGvwKg: 20_000 }, 12_000)?.overKg).toBe(0)
    expect(loadCheck({ axleConfig: 'rigid2' }, 12_000)).toBeNull()
    expect(loadCheck({ tareKg: 9_000 }, 12_000)).toBeNull()
  })

  it('bars a class-3 truck from a route on the Skyway, and only then', () => {
    expect(tollProblems({ tollClass: 3 }, ['skyway', 'makatiCbd']).length).toBe(1)
    expect(tollProblems({ tollClass: 2 }, ['skyway']).length).toBe(0)
    expect(tollProblems({ tollClass: 3 }, ['makatiCbd']).length).toBe(0)
    // No route planned: nothing to say yet.
    expect(tollProblems({ tollClass: 3 }, undefined).length).toBe(0)
    // Unknown class on a heavy truck reads as class 3.
    expect(tollProblems({ gvwKg: 18_000 }, ['skyway']).length).toBe(1)
  })
})

describe('zones', () => {
  it('reads the places a route line passes through', () => {
    // Down EDSA from Cubao to Guadalupe, then into the Makati CBD.
    const edsa: [number, number][] = [[14.619, 121.053], [14.610, 121.055], [14.600, 121.057], [14.590, 121.058], [14.580, 121.054], [14.566, 121.045], [14.556, 121.030], [14.556, 121.022]]
    const z = zonesCrossed(edsa)
    expect(z).toContain('edsa')
    expect(z).toContain('makatiCbd')
    expect(z).not.toContain('paranaque')
    // A road that merely crosses EDSA is not on it.
    const across: [number, number][] = [[14.590, 121.040], [14.590, 121.050], [14.590, 121.058], [14.590, 121.066], [14.590, 121.075]]
    expect(zonesCrossed(across)).not.toContain('edsa')
  })

  it('confines a city ban to trips whose route enters the city', () => {
    const rules = builtInRules(withValue({ enabled: { makatiTruckBan: true } }))
    const hit = (zones?: string[]) => bansFor(rules, 'ABC 1235', TUE_NOON, { zones }).some((r) => r.builtin === 'makatiTruckBan')
    expect(hit(['makatiCbd'])).toBe(true)
    expect(hit(['paranaque'])).toBe(false)
    expect(hit(undefined)).toBe(false)
  })
})
