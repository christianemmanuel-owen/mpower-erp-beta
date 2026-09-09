// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { DEFAULT_HR_CONFIG } from '../../data/statutory'
import type { Personnel } from '../../data/types'

const employee = {
  id: 'p1', createdAt: '', updatedAt: '', name: 'J. Santos', role: 'driver',
  contactNumber: '0917 000 0000', active: true, rateType: 'daily', baseRate: 800,
  allowancePerDay: 0, paySchedule: 'semi_monthly',
  statutory: { sss: true, philhealth: true, pagibig: true, withholdingTax: false },
  govIds: {}, leaveEntitlements: [{ typeId: 'sil', daysPerYear: 5 }],
} as unknown as Personnel

const update = vi.fn(async () => ({}))
const add = vi.fn(async () => ({}))
const remove = vi.fn(async () => ({}))
vi.mock('../../data/repo', () => ({
  repos: {
    personnel: {
      update: (...a: unknown[]) => update(...(a as [])),
      add: (...a: unknown[]) => add(...(a as [])),
      remove: (...a: unknown[]) => remove(...(a as [])),
    },
  },
}))
// Nothing points at this employee, so deleting is allowed.
vi.mock('../../lib/data', () => ({
  fetchTable: async () => [],
  useTables: () => ({ personnel: [employee], agents: [{ id: 'ag1', name: 'A. Reyes' }], shifts: [] }),
}))
vi.mock('../../lib/hrConfig', () => ({ useHrConfig: () => ({ config: DEFAULT_HR_CONFIG }) }))

import EmployeesTab from './EmployeesTab'

afterEach(() => { cleanup(); update.mockClear(); add.mockClear(); remove.mockClear() })

const openEdit = () => {
  render(<EmployeesTab />)
  fireEvent.click(screen.getByRole('row', { name: /J\. Santos/ }))
  return within(screen.getByRole('dialog'))
}

describe('Employee form', () => {
  /**
   * The name check used to call onError, which writes a red box onto the page
   * BEHIND the dialog - a message shown where the person is not looking.
   */
  it('says what is wrong on the field, inside the dialog', () => {
    const form = openEdit()
    fireEvent.change(form.getByLabelText('Full name'), { target: { value: '  ' } })
    fireEvent.click(form.getByRole('button', { name: 'Save changes' }))

    expect(form.getByText('The employee needs a name.')).toBeTruthy()
    expect(form.getByLabelText('Full name').getAttribute('aria-invalid')).toBe('true')
    expect(update).not.toHaveBeenCalled()
  })

  /** Linking an agent and leaving the rate at zero saved a commission setup
   *  that pays nothing, and said nothing about it. */
  it('will not save an agent on commission with no rate', () => {
    const form = openEdit()
    fireEvent.change(form.getByLabelText('Linked sales agent'), { target: { value: 'ag1' } })
    fireEvent.click(form.getByRole('button', { name: 'Save changes' }))

    expect(form.getByText(/needs a rate, or unlink the agent/)).toBeTruthy()
    expect(update).not.toHaveBeenCalled()

    fireEvent.change(form.getByLabelText('Rate (₱/L)'), { target: { value: '0.35' } })
    fireEvent.click(form.getByRole('button', { name: 'Save changes' }))
    expect(update).toHaveBeenCalledTimes(1)
  })

  /** The toggles say whether to deduct; the rail says how much, which is the
   *  question anyone has when they flip one. */
  it('shows what the statutory deductions come to at this rate', () => {
    const form = openEdit()
    expect(form.getByText('Monthly deductions')).toBeTruthy()
    expect(form.getByText('SSS')).toBeTruthy()

    // Turning one off takes it out of the figure rather than leaving it there.
    fireEvent.click(form.getByRole('switch', { name: 'Deduct SSS' }))
    expect(form.queryByText('SSS')).toBeNull()
  })

  it('warns in the rail when there is no rate to pay', () => {
    const form = openEdit()
    fireEvent.change(form.getByLabelText('Daily rate (₱)'), { target: { value: '0' } })
    expect(form.getByText(/No rate set/)).toBeTruthy()
  })

  /** Deleting a person was a browser confirm; being refused was a sentence
   *  written onto the page after the dialog closed. */
  it('confirms a delete in the app, and only once it is allowed', async () => {
    const form = openEdit()
    fireEvent.click(form.getByRole('button', { name: 'Delete employee' }))
    const confirmDialog = await screen.findByText(/Delete J\. Santos\?/)
    expect(confirmDialog).toBeTruthy()
    expect(remove).not.toHaveBeenCalled()
  })
})
