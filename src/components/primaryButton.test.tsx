// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { PrimaryButton } from './ui'

afterEach(cleanup)

describe('PrimaryButton', () => {
  it('is ink-on-white at both sizes', () => {
    // The accent-tinted variant this replaced was teal text on a teal wash, which
    // read as a chip rather than as the action on the screen.
    const md = render(<PrimaryButton>Save</PrimaryButton>)
    expect(md.container.innerHTML).toContain('bg-ink')
    expect(md.container.innerHTML).toContain('text-white')
    cleanup()
    const sm = render(<PrimaryButton size="sm">Save</PrimaryButton>)
    expect(sm.container.innerHTML).toContain('bg-ink')
    expect(sm.container.innerHTML).toContain('text-white')
  })

  it('changes only its scale between sizes', () => {
    // Pinned to the two shared heights rather than to padding literals: the
    // point of the sizes is that a control is either toolbar-height or
    // form-height, and nothing in between.
    const md = render(<PrimaryButton>Save</PrimaryButton>).container.innerHTML
    cleanup()
    const sm = render(<PrimaryButton size="sm">Save</PrimaryButton>).container.innerHTML
    expect(md).toContain('h-[34px]')
    expect(sm).toContain('h-[28px]')
    expect(sm).not.toContain('h-[34px]')
  })

  it('is one of the two standard heights, whichever size it is', () => {
    // The filter row had a 27px search box, a 27px dropdown and a 21px Export
    // button in it. Anything that regresses to a third height fails here.
    for (const size of ['sm', 'md'] as const) {
      const html = render(<PrimaryButton size={size}>Save</PrimaryButton>).container.innerHTML
      expect(/h-\[(28|34)px\]/.test(html)).toBe(true)
      cleanup()
    }
  })

  it('does not fire while disabled', () => {
    const onClick = vi.fn()
    const { getByRole } = render(<PrimaryButton disabled onClick={onClick}>Upload</PrimaryButton>)
    fireEvent.click(getByRole('button'))
    expect(onClick).not.toHaveBeenCalled()
    expect((getByRole('button') as HTMLButtonElement).disabled).toBe(true)
  })

  it('never submits a form it happens to sit inside', () => {
    // Several of these live inside dialogs that contain form controls.
    const { getByRole } = render(<PrimaryButton>Save</PrimaryButton>)
    expect(getByRole('button').getAttribute('type')).toBe('button')
  })
})
