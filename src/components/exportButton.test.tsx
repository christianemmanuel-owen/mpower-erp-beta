// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { ExportButton } from './ui'

afterEach(cleanup)

describe('ExportButton', () => {
  it('is the neutral control, not the accent-tinted one it replaced', () => {
    // One screen still had a hand-rolled teal-on-teal copy after the rest had
    // moved on, which is the drift this component exists to stop.
    const { container } = render(<ExportButton onClick={() => {}} />)
    const html = container.innerHTML
    expect(html).not.toContain('bg-tealbadge')
    expect(html).toContain('bg-white')
  })

  it('says what it will do on hover', () => {
    const { getByRole } = render(<ExportButton onClick={() => {}} />)
    expect(getByRole('button').getAttribute('title')).toMatch(/spreadsheet/i)
  })

  it('exports when clicked', () => {
    const onClick = vi.fn()
    const { getByRole } = render(<ExportButton onClick={onClick} />)
    fireEvent.click(getByRole('button'))
    expect(onClick).toHaveBeenCalledOnce()
  })
})
