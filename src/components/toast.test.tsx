// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ToastProvider, useToast } from './Toast'

afterEach(() => { cleanup(); vi.useRealTimers() })

function Fire({ message = 'Sent for approval' }: { message?: string }) {
  const toast = useToast()
  return <button onClick={() => toast(message)}>fire</button>
}

const host = (ui = <Fire />) => render(<ToastProvider>{ui}</ToastProvider>)

describe('Toast', () => {
  it('shows the message and takes it away on its own', () => {
    vi.useFakeTimers()
    host()
    fireEvent.click(screen.getByText('fire'))
    expect(screen.getByText('Sent for approval')).toBeTruthy()
    act(() => { vi.advanceTimersByTime(6100) })
    expect(screen.queryByText('Sent for approval')).toBeNull()
  })

  it('can be dismissed before its time is up', () => {
    host()
    fireEvent.click(screen.getByText('fire'))
    fireEvent.click(screen.getByLabelText('Dismiss'))
    expect(screen.queryByText('Sent for approval')).toBeNull()
  })

  it('holds the message open while it is being read', () => {
    vi.useFakeTimers()
    const { container } = host()
    fireEvent.click(screen.getByText('fire'))
    const row = screen.getByText('Sent for approval').parentElement as HTMLElement
    fireEvent.mouseEnter(row)
    act(() => { vi.advanceTimersByTime(20000) })
    expect(screen.getByText('Sent for approval')).toBeTruthy()
    fireEvent.mouseLeave(row)
    act(() => { vi.advanceTimersByTime(6100) })
    expect(container.ownerDocument.body.textContent).not.toContain('Sent for approval')
  })

  it('does not stack the same message twice', () => {
    host()
    fireEvent.click(screen.getByText('fire'))
    fireEvent.click(screen.getByText('fire'))
    expect(screen.getAllByText('Sent for approval')).toHaveLength(1)
  })

  it('announces politely rather than interrupting', () => {
    host()
    fireEvent.click(screen.getByText('fire'))
    const region = document.querySelector('[role="status"]')
    expect(region?.getAttribute('aria-live')).toBe('polite')
  })

  it('refuses to fire outside a provider, rather than swallowing the message', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Fire />)).toThrow(/ToastProvider/)
    quiet.mockRestore()
  })
})
