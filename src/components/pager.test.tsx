// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { Pager } from './ui'

afterEach(cleanup)

const props = { page: 1, totalPages: 3, total: 20, pageSize: 8, setPage: () => {} }

describe('Pager', () => {
  it('says nothing when everything fits on one page', () => {
    const { container } = render(<Pager {...props} totalPages={1} total={5} />)
    expect(container.textContent).toBe('')
  })

  it('spells the range out in full by default', () => {
    const { container } = render(<Pager {...props} noun="employees" />)
    expect(container.textContent).toContain('Showing 1–8 of 20 employees')
    expect(container.textContent).toContain('Page 1 of 3')
  })

  it('shortens to fit a narrow column when compact', () => {
    // The side panel is 340px. The default footer wraps there, which is what the
    // compact variant exists to avoid, so this pins the shorter strings rather
    // than a width no test can measure in jsdom.
    const { container } = render(<Pager {...props} noun="employees" compact />)
    const text = container.textContent ?? ''
    expect(text).toContain('1–8 of 20')
    expect(text).not.toContain('Showing')
    expect(text).not.toContain('employees')
    expect(text).not.toContain('Prev')
    expect(text).toContain('1 / 3')
  })

  it('keeps the arrows reachable by name once their labels are gone', () => {
    const { getByLabelText } = render(<Pager {...props} compact />)
    expect(getByLabelText('Previous page')).toBeTruthy()
    expect(getByLabelText('Next page')).toBeTruthy()
  })

  it('disables the arrow that would run off the end', () => {
    const first = render(<Pager {...props} page={1} compact />)
    expect((first.getByLabelText('Previous page') as HTMLButtonElement).disabled).toBe(true)
    expect((first.getByLabelText('Next page') as HTMLButtonElement).disabled).toBe(false)
    cleanup()
    const last = render(<Pager {...props} page={3} compact />)
    expect((last.getByLabelText('Previous page') as HTMLButtonElement).disabled).toBe(false)
    expect((last.getByLabelText('Next page') as HTMLButtonElement).disabled).toBe(true)
  })

  it('steps one page at a time', () => {
    const setPage = vi.fn()
    const { getByLabelText } = render(<Pager {...props} page={2} setPage={setPage} compact />)
    fireEvent.click(getByLabelText('Next page'))
    expect(setPage.mock.calls[0][0](2)).toBe(3)
    fireEvent.click(getByLabelText('Previous page'))
    expect(setPage.mock.calls[1][0](2)).toBe(1)
  })
})
