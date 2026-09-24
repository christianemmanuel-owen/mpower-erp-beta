// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Dock, useKeyboardOpen } from './shell'

/**
 * The phone keyboard has no event of its own; the app infers it from a text
 * control taking focus while the visual viewport is short, and lets go of
 * everything pinned to the bottom edge - otherwise the dock and the tab bar
 * ride up on the keyboard and cover the field being typed in.
 */
afterEach(cleanup)

function Probe() {
  const on = useKeyboardOpen()
  return <span data-testid="kb">{on ? 'up' : 'down'}</span>
}

const shrink = (short: boolean) => {
  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    value: { height: short ? window.innerHeight * 0.5 : window.innerHeight, addEventListener() {}, removeEventListener() {} },
  })
}

describe('useKeyboardOpen', () => {
  it('is up only while a text control has focus and the viewport has shrunk', async () => {
    shrink(true)
    render(<><input aria-label="Name" /><input type="checkbox" aria-label="Tick" /><Probe /></>)
    expect(screen.getByTestId('kb').textContent).toBe('down')
    act(() => { screen.getByLabelText('Name').focus() })
    expect(screen.getByTestId('kb').textContent).toBe('up')
    act(() => { screen.getByLabelText('Tick').focus() })
    await act(async () => { await new Promise((r) => setTimeout(r, 80)) })
    expect(screen.getByTestId('kb').textContent).toBe('down')
  })

  it('stays down with a full-height viewport - a hardware keyboard, a laptop', () => {
    shrink(false)
    render(<><input aria-label="Name" /><Probe /></>)
    act(() => { screen.getByLabelText('Name').focus() })
    expect(screen.getByTestId('kb').textContent).toBe('down')
  })

  it('lets the dock go while typing', () => {
    shrink(true)
    render(<><input aria-label="Name" /><Dock><button type="button">Save</button></Dock></>)
    const dock = screen.getByRole('button', { name: 'Save' }).parentElement!
    expect(dock.className).toContain('sticky')
    act(() => { fireEvent.focusIn(screen.getByLabelText('Name')); screen.getByLabelText('Name').focus() })
    expect(dock.className).toContain('static')
  })
})
