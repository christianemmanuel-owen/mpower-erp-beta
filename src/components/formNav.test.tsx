// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { FormNav, useSectionNav, type FormNavSection } from './FormNav'

afterEach(cleanup)

const SECTIONS: FormNavSection[] = [
  { id: 'sec-who', title: 'Who', state: 'done' },
  { id: 'sec-fuel', title: 'The fuel', state: 'problem' },
  { id: 'sec-plan', title: 'Collection plan', state: 'todo' },
]

describe('FormNav', () => {
  it('lists the form parts and marks the one you are in', () => {
    render(<FormNav sections={SECTIONS} active="sec-fuel" onJump={() => {}} />)
    expect(screen.getByRole('button', { name: /The fuel/ }).getAttribute('aria-current')).toBe('true')
    expect(screen.getByRole('button', { name: /Who/ }).getAttribute('aria-current')).toBeNull()
  })

  it('says which sections are filled and which need something', () => {
    render(<FormNav sections={SECTIONS} active="sec-who" onJump={() => {}} />)
    expect(screen.getByLabelText('filled in')).toBeTruthy()
    expect(screen.getByLabelText('needs attention')).toBeTruthy()
  })

  it('asks to go to the section that was clicked', () => {
    const onJump = vi.fn()
    render(<FormNav sections={SECTIONS} active="sec-who" onJump={onJump} />)
    fireEvent.click(screen.getByRole('button', { name: /Collection plan/ }))
    expect(onJump).toHaveBeenCalledWith('sec-plan')
  })

  it('gates nothing - every section is reachable from any other', () => {
    // Deliberately not a wizard: the form can be filled in any order, so no
    // row is ever disabled.
    render(<FormNav sections={SECTIONS} active="sec-who" onJump={() => {}} />)
    for (const s of SECTIONS) {
      expect(screen.getByRole('button', { name: new RegExp(s.title) }).hasAttribute('disabled')).toBe(false)
    }
  })
})

/** Renders the hook against a real scroll container shaped like Dialog's body. */
function Harness({ ids }: { ids: string[] }) {
  const { active, jump } = useSectionNav(ids)
  return (
    <div>
      <span data-testid="active">{active}</span>
      <button onClick={() => jump(ids[2])}>go</button>
      <div data-dialog-body data-testid="box" style={{ height: 200, overflowY: 'auto' }}>
        {ids.map((id) => <p key={id} id={id}>{id}</p>)}
      </div>
    </div>
  )
}

/** jsdom has no layout, so every rect is 0 and every section would read as
 *  "at the top". These stub the geometry the hook actually measures. */
function layout(tops: Record<string, number>, boxTop = 0) {
  const orig = Element.prototype.getBoundingClientRect
  Element.prototype.getBoundingClientRect = function () {
    const id = (this as HTMLElement).id
    const top = id in tops ? tops[id] : boxTop
    return { top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top, toJSON() {} } as DOMRect
  }
  return () => { Element.prototype.getBoundingClientRect = orig }
}

describe('useSectionNav', () => {
  it('reads the section at the top of the dialog body as the current one', () => {
    const restore = layout({ a: 10, b: 300, c: 600 })
    render(<Harness ids={['a', 'b', 'c']} />)
    expect(screen.getByTestId('active').textContent).toBe('a')
    restore()
  })

  it('moves on once a later section reaches the top', () => {
    // Scrolled down: a and b are above the fold, c is not yet.
    const restore = layout({ a: -400, b: 8, c: 320 })
    render(<Harness ids={['a', 'b', 'c']} />)
    expect(screen.getByTestId('active').textContent).toBe('b')
    restore()
  })

  it('scrolls the clicked section into view', () => {
    // jsdom has no layout, so the call is what can be asserted - that the right
    // element was asked for, and that it did not throw looking for a window
    // scroller instead of the dialog's own.
    const into = vi.fn()
    const orig = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = into
    render(<Harness ids={['a', 'b', 'c']} />)
    fireEvent.click(screen.getByText('go'))
    expect(into).toHaveBeenCalled()
    expect(screen.getByTestId('active').textContent).toBe('c')
    Element.prototype.scrollIntoView = orig
  })

  it('survives a form whose sections are not mounted yet', () => {
    expect(() => render(<Harness ids={[]} />)).not.toThrow()
  })
})
