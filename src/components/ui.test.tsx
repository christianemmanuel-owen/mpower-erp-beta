// @vitest-environment jsdom
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DataTable, Dialog, Field, InfoTip, Input, Select, Switch } from './ui'

afterEach(cleanup)

describe('Dialog', () => {
  it('announces itself as a modal named by its title', () => {
    render(<Dialog open title="Book maintenance" onClose={vi.fn()}><p>body</p></Dialog>)
    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(screen.getByRole('heading', { name: 'Book maintenance' })).toBeTruthy()
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(<Dialog open title="X" onClose={onClose}><p>body</p></Dialog>)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('closes on a click outside the panel', () => {
    const onClose = vi.fn()
    const { container } = render(<Dialog open title="X" onClose={onClose}><p>body</p></Dialog>)
    void container
    fireEvent.click(document.querySelector('.absolute.inset-0')!)
    expect(onClose).toHaveBeenCalled()
  })

  it('puts focus on the first real control rather than the close button', () => {
    render(
      <Dialog open title="X" onClose={vi.fn()}>
        <Field label="Vendor"><Input defaultValue="" /></Field>
      </Dialog>,
    )
    expect(document.activeElement).toBe(screen.getByLabelText('Vendor'))
  })

  it('locks the page behind it and gives the scroll back on close', () => {
    const { rerender } = render(<Dialog open title="X" onClose={vi.fn()}><p>body</p></Dialog>)
    expect(document.body.style.overflow).toBe('hidden')
    rerender(<Dialog open={false} title="X" onClose={vi.fn()}><p>body</p></Dialog>)
    expect(document.body.style.overflow).not.toBe('hidden')
  })

  it('keeps the caret where you are typing when the parent re-renders', () => {
    // Regression: the setup effect listed `onClose` in its deps, and every
    // caller passes an inline arrow, so each keystroke re-ran it and pulled
    // focus back to the first control. Typing one character into the second
    // field of the New seat form threw you back to Full name.
    function Host() {
      const [name, setName] = useState('')
      const [role, setRole] = useState('')
      return (
        <Dialog open title="New seat" onClose={() => {}}>
          <input aria-label="Full name" value={name} onChange={(e) => setName(e.target.value)} />
          <input aria-label="Role label" value={role} onChange={(e) => setRole(e.target.value)} />
        </Dialog>
      )
    }
    render(<Host />)
    const role = screen.getByLabelText('Role label') as HTMLInputElement
    role.focus()
    fireEvent.change(role, { target: { value: 'Enc' } })
    expect(document.activeElement).toBe(role)
    fireEvent.change(role, { target: { value: 'Encoder' } })
    expect(document.activeElement).toBe(role)
    expect(role.value).toBe('Encoder')
  })

  it('still puts the caret in the first control when it opens', () => {
    function Host() {
      const [v, setV] = useState('')
      return (
        <Dialog open title="New seat" onClose={() => {}}>
          <input aria-label="Full name" value={v} onChange={(e) => setV(e.target.value)} />
          <input aria-label="Role label" />
        </Dialog>
      )
    }
    render(<Host />)
    expect(document.activeElement).toBe(screen.getByLabelText('Full name'))
  })

  it('shows one step at a time and holds the real actions until the last', () => {
    // A long form that shows Approve on page one invites deciding before
    // reading, which is the whole reason the steps exist.
    render(
      <Dialog
        open
        title="Pending input"
        onClose={() => {}}
        footer={<button>Approve</button>}
        steps={[
          { title: 'Order', content: <p>order body</p> },
          { title: 'Review', content: <p>review body</p> },
        ]}
      />,
    )
    expect(screen.getByText('order body')).toBeTruthy()
    expect(screen.queryByText('review body')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('review body')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy()
  })

  it('lets you go back but not skip ahead', () => {
    render(
      <Dialog
        open
        title="X"
        onClose={() => {}}
        steps={[
          { title: 'One', content: <p>one body</p> },
          { title: 'Two', content: <p>two body</p> },
          { title: 'Three', content: <p>three body</p> },
        ]}
      />,
    )
    // Nobody should reach a decision page without opening the ones before it.
    expect(screen.getByRole('button', { name: 'Three' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('two body')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'One' }))
    expect(screen.getByText('one body')).toBeTruthy()
  })

  it('starts a reopened dialog at the first step', () => {
    const { rerender } = render(
      <Dialog open title="X" onClose={() => {}} steps={[
        { title: 'One', content: <p>one body</p> },
        { title: 'Two', content: <p>two body</p> },
      ]} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('two body')).toBeTruthy()

    const steps = [
      { title: 'One', content: <p>one body</p> },
      { title: 'Two', content: <p>two body</p> },
    ]
    rerender(<Dialog open={false} title="X" onClose={() => {}} steps={steps} />)
    rerender(<Dialog open title="X" onClose={() => {}} steps={steps} />)
    // Otherwise the next record opens on page two of the last one.
    expect(screen.getByText('one body')).toBeTruthy()
  })

  it('behaves like a plain dialog when given no steps', () => {
    render(<Dialog open title="X" onClose={() => {}} footer={<button>Save</button>}><p>body</p></Dialog>)
    expect(screen.getByText('body')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull()
  })

  it('carries provenance in the header, where every step can see it', () => {
    // On a stepped dialog this used to sit in the body, which meant it showed
    // on page one and was gone for the page the decision is made on.
    render(
      <Dialog
        open
        title="New sale"
        subtitle="4,000 L @ ₱50.53/L"
        aside={<span>Test User</span>}
        onClose={() => {}}
        steps={[
          { title: 'Order', content: <p>order body</p> },
          { title: 'Review', content: <p>review body</p> },
        ]}
      />,
    )
    expect(screen.getByText('Test User')).toBeTruthy()
    expect(screen.getByText('4,000 L @ ₱50.53/L')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('Test User')).toBeTruthy()
  })

  it('keeps the figures column in view beside a scrolling form', () => {
    render(
      <Dialog open title="New sale" onClose={() => {}} rail={<p>rail body</p>}>
        <p>form body</p>
      </Dialog>,
    )
    expect(screen.getByText('form body')).toBeTruthy()
    expect(screen.getByText('rail body')).toBeTruthy()
  })

  /**
   * A navigated or stepped dialog holds its height.
   *
   * Both kinds change content constantly - sections collapse, steps turn - and
   * a panel sized to its content re-centres on every change, sliding the form
   * under the cursor and moving the footer out from under a click already on
   * its way. Everything else still fits itself: a 700px box around a confirm
   * dialog is its own problem.
   */
  /**
   * A wide table scrolls inside itself, not by dragging the page sideways.
   * Nowrap cells give a table a minimum width; when the content column is
   * narrower than that, the overflow used to reach the page and slide the whole
   * layout out from under the fixed sidebar.
   */
  it('keeps a wide table inside its own scroller', () => {
    render(
      <DataTable cols={[{ label: 'Due' }, { label: 'Customer' }]}>
        <tr><td>Sep 9</td><td>Nova Fuels</td></tr>
      </DataTable>,
    )
    const table = screen.getByRole('table')
    expect(table.parentElement?.className).toContain('overflow-x-auto')
  })

  it('holds a steady height for long forms and fits itself for short ones', () => {
    render(<Dialog open title="Trip" onClose={() => {}} nav={<p>nav</p>}>body</Dialog>)
    expect(screen.getByRole('dialog').className).toContain('h-[85vh]')
    expect(screen.getByRole('dialog').className).not.toContain('max-h-[85vh]')

    cleanup()
    render(<Dialog open title="Confirm" onClose={() => {}}>body</Dialog>)
    expect(screen.getByRole('dialog').className).toContain('max-h-[85vh]')
  })

  it('renders nothing at all when closed', () => {
    render(<Dialog open={false} title="X" onClose={vi.fn()}><p>body</p></Dialog>)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('Input and Select', () => {
  it('keep a className the caller passes instead of dropping it', () => {
    // They used to assign className outright after spreading props, so the
    // prop was overwritten a line after arriving. The installment amount field
    // needs `nospin` to survive, or Chrome's number arrows eat the column.
    render(<Input className="nospin" aria-label="Base amount" />)
    render(<Select className="nospin" aria-label="Status" />)
    expect(screen.getByLabelText('Base amount').className).toContain('nospin')
    expect(screen.getByLabelText('Status').className).toContain('nospin')
  })

  it('still carry the shared control styling', () => {
    render(<Input className="nospin" aria-label="Base amount" />)
    expect(screen.getByLabelText('Base amount').className).toContain('h-[34px]')
  })
})

describe('Switch', () => {
  /**
   * A switch in a table needs no text of its own - the column header names it.
   * A switch in a form does: four bare toggles under a grid of text fields say
   * nothing about what they turn off, which is exactly how they shipped.
   */
  it('shows its name when given one, and toggles from the text too', () => {
    const onChange = vi.fn()
    render(<Switch checked={false} label="Deduct SSS" text="Deduct SSS" onChange={onChange} />)
    expect(screen.getByText('Deduct SSS')).toBeTruthy()

    fireEvent.click(screen.getByText('Deduct SSS'))
    expect(onChange).toHaveBeenCalledWith(true)
  })


  it('announces itself as a switch and reports its state', () => {
    // It replaces a teal "TURN OFF" text button, which read as a link and
    // stated the action rather than the state.
    render(<Switch checked label="Watch Batangas depot" onChange={() => {}} />)
    const el = screen.getByRole('switch', { name: 'Watch Batangas depot' }) as HTMLInputElement
    expect(el.checked).toBe(true)
  })

  it('reports the state it is being moved to', () => {
    const onChange = vi.fn()
    render(<Switch checked label="Watch Batangas depot" onChange={onChange} />)
    fireEvent.click(screen.getByRole('switch'))
    expect(onChange).toHaveBeenCalledWith(false)
  })

  it('does nothing while disabled', () => {
    const onChange = vi.fn()
    render(<Switch checked={false} disabled label="No level set" onChange={onChange} />)
    fireEvent.click(screen.getByRole('switch'))
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('Field', () => {
  it('says what is wrong on the control it is about', () => {
    // The forms used to check on Save and return at the first failure, so the
    // message appeared in a banner rather than on the field that was wrong.
    render(<Field label="Volume (L)" error="Enter the volume sold."><Input /></Field>)
    const input = screen.getByLabelText('Volume (L)')
    expect(screen.getByText('Enter the volume sold.')).toBeTruthy()
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(input.getAttribute('aria-describedby')).toBeTruthy()
  })

  it('lets the problem replace the hint rather than stacking both', () => {
    render(<Field label="Volume (L)" hint="In litres" error="Enter the volume sold."><Input /></Field>)
    expect(screen.queryByText('In litres')).toBeNull()
  })

  it('is not marked invalid when nothing is wrong', () => {
    render(<Field label="Volume (L)"><Input /></Field>)
    expect(screen.getByLabelText('Volume (L)').getAttribute('aria-invalid')).toBeNull()
  })

  it('labels the control it wraps', () => {
    render(<Field label="Warn below"><Input type="number" /></Field>)
    expect(screen.getByLabelText('Warn below').tagName).toBe('INPUT')
  })

  it('labels a select the same way', () => {
    render(<Field label="Warehouse"><Select><option>A</option></Select></Field>)
    expect(screen.getByLabelText('Warehouse').tagName).toBe('SELECT')
  })

  it('attaches the hint to the control for a screen reader', () => {
    render(<Field label="Cost" hint="Leave blank if unknown."><Input /></Field>)
    const input = screen.getByLabelText('Cost')
    const describedBy = input.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(document.getElementById(describedBy!)?.textContent).toBe('Leave blank if unknown.')
  })

  it('does not swallow a group of controls into one label', () => {
    // The bug this replaced: a <label> with no `for` attaches to the first
    // labelable thing inside it, so the first button announced itself as the
    // whole legend plus every other button's text.
    render(
      <Field label="Days">
        <span>
          <button type="button" role="checkbox" aria-checked={false}>Mon</button>
          <button type="button" role="checkbox" aria-checked={false}>Tue</button>
        </span>
      </Field>,
    )
    expect(screen.getByRole('checkbox', { name: 'Mon' })).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: 'Tue' })).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Days' })).toBeTruthy()
  })

  it('leaves an id the caller set alone', () => {
    render(<Field label="Vendor"><Input id="my-vendor" /></Field>)
    expect(screen.getByLabelText('Vendor').getAttribute('id')).toBe('my-vendor')
  })
})

describe('InfoTip', () => {
  it('describes the control it is attached to, without needing to be opened', () => {
    render(<InfoTip label="Why this figure is incomplete">146 have no date.</InfoTip>)
    const marker = screen.getByRole('button', { name: 'Why this figure is incomplete' })
    const describedBy = marker.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    // The sentence is in the DOM rather than conjured on hover, so a screen
    // reader reaches it without triggering anything.
    expect(document.getElementById(describedBy!)?.textContent).toContain('146 have no date.')
  })

  it('marks the explanation as a tooltip', () => {
    render(<InfoTip label="Why">Because.</InfoTip>)
    expect(screen.getByRole('tooltip', { hidden: true }).textContent).toBe('Because.')
  })

  it('does not inherit the shouting from the label it sits in', () => {
    // It lives inside an uppercase, letter-spaced KPI label and inherited both,
    // so the sentence rendered as small caps.
    render(<InfoTip label="Why">Because.</InfoTip>)
    const tip = screen.getByRole('tooltip', { hidden: true })
    expect(tip.className).toContain('normal-case')
    expect(tip.className).toContain('tracking-normal')
  })

  it('keeps itself inside the page rather than running off the right edge', () => {
    render(<InfoTip label="Why">Because.</InfoTip>)
    const marker = screen.getByRole('button', { name: 'Why' })
    const tip = screen.getByRole('tooltip', { hidden: true })

    const at = (left: number) => {
      marker.getBoundingClientRect = () => ({
        left, right: left + 14, top: 0, bottom: 14, width: 14, height: 14, x: left, y: 0, toJSON: () => ({}),
      })
      fireEvent.focus(marker)
    }

    at(40)
    expect(tip.style.left).toBe('40px')

    fireEvent.blur(marker)
    // Near the right edge of a 1024px jsdom window, 248px of tip will not fit,
    // so it slides back rather than being cut off.
    at(1000)
    expect(Number.parseFloat(tip.style.left)).toBe(1024 - 248 - 8)
  })

  /** The rail on the right is fixed over the page. A tip that stopped at the
   *  window edge slid under it and was unreadable. */
  it('stays clear of the fixed rail when one is open', () => {
    document.documentElement.style.setProperty('--todo-rail-w', '280px')
    render(<InfoTip label="Why">Because.</InfoTip>)
    const marker = screen.getByRole('button', { name: 'Why' })
    marker.getBoundingClientRect = () => ({
      left: 700, right: 714, top: 0, bottom: 14, width: 14, height: 14, x: 700, y: 0, toJSON: () => ({}),
    })
    fireEvent.focus(marker)
    expect(Number.parseFloat(screen.getByRole('tooltip', { hidden: true }).style.left))
      .toBe(1024 - 280 - 8 - 248)
    document.documentElement.style.removeProperty('--todo-rail-w')
  })

  /** Any scrolling ancestor used to clip it - the rail of a dialog cut the
   *  credit-score explanation in half. It lives in <body> now. */
  it('renders outside the box it explains', () => {
    const { container } = render(<span style={{ overflow: 'auto' }}><InfoTip label="Why">Because.</InfoTip></span>)
    const tip = screen.getByRole('tooltip', { hidden: true })
    expect(container.contains(tip)).toBe(false)
    expect(tip.className).toContain('fixed')
  })

  it('reveals on keyboard focus, not hover alone', () => {
    render(<InfoTip label="Why">Because.</InfoTip>)
    const tip = screen.getByRole('tooltip', { hidden: true })
    expect(tip.className).toContain('opacity-0')
    fireEvent.focus(screen.getByRole('button', { name: 'Why' }))
    expect(tip.className).toContain('opacity-100')
  })
})
