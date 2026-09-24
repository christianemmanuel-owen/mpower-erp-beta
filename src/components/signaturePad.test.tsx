// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import SignaturePad from './SignaturePad'
import { RESIGN_SNOOZE_MS, resignSnoozed, snoozeResign } from '../lib/signGuard'

/**
 * Re-sign wipes a signature that is somebody's record of having checked or
 * received. It asks first; "I know what I'm doing" stops it asking for five
 * minutes, in this tab.
 */
const signed = { name: 'Vic Torres', image: 'data:image/png;base64,AA==', at: '2026-09-24T08:00:00.000Z' }

beforeEach(() => sessionStorage.clear())
afterEach(cleanup)

describe('Re-sign guardrail', () => {
  it('asks before wiping, and Keep it leaves the signature alone', () => {
    const onChange = vi.fn()
    render(<SignaturePad label="Driver" name="Vic Torres" value={signed} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Re-sign' }))
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Replace this signature?' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }))
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('wipes on the second Re-sign', () => {
    const onChange = vi.fn()
    render(<SignaturePad label="Driver" name="Vic Torres" value={signed} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Re-sign' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Re-sign' }))
    expect(onChange).toHaveBeenCalledWith(undefined)
    expect(resignSnoozed()).toBe(false)
  })

  it('"I know what I\'m doing" wipes now and stops asking for five minutes', () => {
    const onChange = vi.fn()
    const { unmount } = render(<SignaturePad label="Driver" name="Vic Torres" value={signed} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Re-sign' }))
    fireEvent.click(screen.getByRole('checkbox', { name: /I know what I’m doing/ }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Re-sign' }))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(resignSnoozed()).toBe(true)
    unmount()
    // Another pad, same tab: no question.
    const again = vi.fn()
    render(<SignaturePad label="Pahinante" name="Nonoy Lopez" value={{ ...signed, name: 'Nonoy Lopez' }} onChange={again} />)
    fireEvent.click(screen.getByRole('button', { name: 'Re-sign' }))
    expect(again).toHaveBeenCalledWith(undefined)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('the snooze runs out', () => {
    const t0 = 1_000_000
    snoozeResign(RESIGN_SNOOZE_MS, t0)
    expect(resignSnoozed(t0 + RESIGN_SNOOZE_MS - 1)).toBe(true)
    expect(resignSnoozed(t0 + RESIGN_SNOOZE_MS)).toBe(false)
  })
})
