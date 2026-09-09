// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import CustomerForm from './CustomerForm'

afterEach(cleanup)

const update = vi.fn(async () => ({}))
const add = vi.fn(async () => ({}))
vi.mock('../../data/repo', () => ({ repos: { customers: { update: (...a: unknown[]) => update(...(a as [])), add: (...a: unknown[]) => add(...(a as [])) } } }))
vi.mock('../../lib/attachments', async (original) => ({
  ...(await original<typeof import('../../lib/attachments')>()),
  useAttachments: () => ({ data: [] }),
}))

const view = () => render(<CustomerForm open editing={null} onClose={() => {}} onNotice={() => {}} />)

describe('CustomerForm', () => {
  /** It used to return at the first failure with a banner at the top of a
   *  1,200px form, so you fixed one thing to be told about the next. */
  it('reports every problem at once, on the field it is about', () => {
    view()
    fireEvent.change(screen.getByLabelText('Manual credit score'), { target: { value: '140' } })
    fireEvent.change(screen.getByLabelText('Payment terms (days)'), { target: { value: '-3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))

    expect(screen.getByText('An account needs a company name.')).toBeTruthy()
    expect(screen.getByText('A score runs from 0 to 100.')).toBeTruthy()
    expect(screen.getByText(/Enter a number of days/)).toBeTruthy()
    expect(add).not.toHaveBeenCalled()
  })

  it('marks the bad field for a screen reader too', () => {
    view()
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    expect(screen.getByLabelText('Company name').getAttribute('aria-invalid')).toBe('true')
  })

  it('rejects an address that is not one', () => {
    view()
    fireEvent.change(screen.getByLabelText('Company name'), { target: { value: 'Nova Fuels' } })
    const emails = screen.getAllByLabelText('Email')
    fireEvent.change(emails[0], { target: { value: 'ops.novafuels' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    expect(screen.getByText(/does not look like an email/)).toBeTruthy()
    expect(add).not.toHaveBeenCalled()
  })

  /** The three contact points are the point of the form; on a long scroll you
   *  could not see which you had filled without going back up. */
  it('tracks the three contact points in the rail', () => {
    view()
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
    fireEvent.change(screen.getAllByLabelText('Address')[0], { target: { value: 'Km 21 MacArthur Hwy' } })
    expect(screen.getAllByText('Recorded').length).toBe(1)

    fireEvent.click(screen.getAllByRole('button', { name: 'Same as office' })[0])
    expect(screen.getAllByText('Recorded').length).toBe(2)
  })
})
