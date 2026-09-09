// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { Meter } from './ui'

afterEach(cleanup)

/** The fill is the inner span; the outer one is the track. */
const fillOf = (c: HTMLElement) => (c.querySelector('span > span') as HTMLElement).style.width

describe('Meter', () => {
  it('fills in proportion to the max', () => {
    const { container } = render(<Meter value={3} max={5} />)
    expect(fillOf(container)).toBe('60%')
  })

  it('does not divide by a zero max', () => {
    // An employee with no entitlement for a leave type: 0 of 0. Dividing here
    // would put NaN into a style attribute and render an empty bar in some
    // browsers and a full one in others.
    const { container } = render(<Meter value={0} max={0} />)
    expect(fillOf(container)).toBe('0%')
  })

  it('stops at the track when the value is past the max', () => {
    const { container } = render(<Meter value={9} max={5} />)
    expect(fillOf(container)).toBe('100%')
  })

  it('lets the caller decide what passing the max means', () => {
    // Overdrawn leave is a problem; a quota passed is the point of the quota.
    // The same geometry has to be able to read either way.
    const alert = render(<Meter value={9} max={5} tone="alert" />)
    expect(alert.container.innerHTML).toContain('bg-redf')
    cleanup()
    const good = render(<Meter value={9} max={5} tone="good" />)
    expect(good.container.innerHTML).toContain('bg-greentext')
  })
})
