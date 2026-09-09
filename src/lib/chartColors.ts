/**
 * The one chart palette for the whole app.
 *
 * Every chart in here used to carry its own hex literals, which is how the
 * supplier charts drifted onto a blue/violet/magenta set belonging to no other
 * page. The colours below are the ones the app already uses; they simply live
 * in one place now, so a new chart inherits the palette instead of inventing
 * one.
 *
 * SERIES is the categorical set, for charts where colour means "which supplier"
 * rather than "how bad". It is validated - light mode, white card, all pairs -
 * for the OKLCH lightness band, the chroma floor, protan/deutan/tritan
 * separation, the normal-vision floor, and 3:1 against the card:
 *
 *   node validate_palette.js "#0f9b8e,#2a78d6,#4a3aa7,#9c2f6d" \
 *     --mode light --surface "#ffffff" --pairs all      -> ALL CHECKS PASS
 *
 * Two things that constrain any change to it, both found by measuring rather
 * than by looking:
 *
 *  - The app teal #116a63 cannot be a series. At chroma 0.078 it clears the
 *    floor for a button or a filled bar, but as a 2px line among saturated
 *    neighbours it reads grey. SERIES[0] is the same hue carrying enough
 *    chroma to survive as a thin mark.
 *  - Teal and magenta cannot both be series. They sit on opposite ends of the
 *    red-green axis, which is the axis protan and deutan viewers lose, so the
 *    pair collapses to dE 4.5 - indistinguishable. Slot 4 is a deep raspberry
 *    that keeps its distance from slot 1 under simulation.
 *
 * Amber and red are absent on purpose: this app spends them on status (amber
 * watch, red act now), so a supplier tinted amber would read as a warning.
 */
export const SERIES = ['#0f9b8e', '#2a78d6', '#4a3aa7', '#9c2f6d'] as const

/** The accent pair, for the two-series charts (bought vs sold, volume, sparklines). */
export const TEAL = '#116a63'
export const TEAL_BRIGHT = '#159187'
export const TEAL_SOFT = '#b9d6d2'

/** Chart furniture: grid, axis rule, tick text, hover cursor. */
export const GRID = '#eef0f2'
export const AXIS = '#e5e8ea'
export const TICK = '#a8b0b7'
export const CURSOR = '#d3d8dc'

/** Which series colour a supplier draws in - the price chart's lines, the share
 * pie's slices and the supplier list's dots all ask this, so they agree. */
export function supplierColor(id: string, suppliers: { id: string }[]) {
  const i = suppliers.findIndex((s) => s.id === id)
  return SERIES[(i >= 0 ? i : 0) % SERIES.length]
}
