// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import ComposeDock from './ComposeDock'

afterEach(cleanup)

type Props = React.ComponentProps<typeof ComposeDock>

const dock = (over: Partial<Props> = {}) =>
  render(
    <ComposeDock
      show expanded
      idleLabel="New announcement"
      title="New announcement"
      onExpand={vi.fn()} onMinimise={vi.fn()} onDiscard={vi.fn()}
      {...over}
    >
      <input placeholder="Headline" />
    </ComposeDock>,
  )

describe('ComposeDock', () => {
  it('is a dialog named by its title, but not a modal one', () => {
    dock()
    // The page stays usable while composing, so it must not claim otherwise.
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBeNull()
    expect(screen.getByText('New announcement')).toBeTruthy()
  })

  it('does not dim or lock the page', () => {
    dock()
    expect(document.body.style.overflow).not.toBe('hidden')
  })

  it('puts the caret in the first field', () => {
    dock()
    expect(document.activeElement).toBe(screen.getByPlaceholderText('Headline'))
  })

  it('is its own trigger when collapsed', () => {
    // No separate button anywhere else: the way in and the thing it opens are
    // the same object in the same corner.
    const onExpand = vi.fn()
    dock({ expanded: false, onExpand })
    expect(screen.queryByPlaceholderText('Headline')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /new announcement/i }))
    expect(onExpand).toHaveBeenCalled()
  })

  it('minimises on Escape rather than discarding what was typed', () => {
    const onMinimise = vi.fn()
    const onDiscard = vi.fn()
    dock({ onMinimise, onDiscard })
    fireEvent.keyDown(screen.getByPlaceholderText('Headline'), { key: 'Escape' })
    expect(onMinimise).toHaveBeenCalled()
    expect(onDiscard).not.toHaveBeenCalled()
  })

  it('keeps minimise and discard as different actions', () => {
    const onMinimise = vi.fn()
    const onDiscard = vi.fn()
    dock({ onMinimise, onDiscard })
    fireEvent.click(screen.getByRole('button', { name: 'Minimise' }))
    expect(onMinimise).toHaveBeenCalledTimes(1)
    expect(onDiscard).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(onDiscard).toHaveBeenCalledTimes(1)
  })

  it('takes the width it is given, and animates between them', () => {
    const { rerender } = dock({ width: 400 })
    const panel = screen.getByRole('dialog')
    expect(panel.style.width).toBe('400px')
    expect(panel.className).toContain('transition-[width]')
    // Reduced motion gets the new width without the travel.
    expect(panel.className).toContain('motion-reduce:transition-none')

    rerender(
      <ComposeDock
        show expanded idleLabel="New announcement" title="New announcement"
        onExpand={vi.fn()} onMinimise={vi.fn()} onDiscard={vi.fn()} width={520}
      >
        <input placeholder="Headline" />
      </ComposeDock>,
    )
    expect(screen.getByRole('dialog').style.width).toBe('520px')
  })

  it('says on the collapsed bar when a draft is waiting', () => {
    dock({ expanded: false, hasDraft: false })
    expect(screen.queryByText('Draft')).toBeNull()
    cleanup()
    dock({ expanded: false, hasDraft: true })
    expect(screen.getByText('Draft')).toBeTruthy()
  })

  it('renders nothing at all for a seat that may not post', () => {
    dock({ show: false })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
