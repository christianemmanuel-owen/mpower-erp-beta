// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ModuleLink } from './ModuleLink'
import { moduleForPath } from '../lib/nav'

afterEach(cleanup)

const at = (to: string, action?: string) =>
  render(<MemoryRouter><ModuleLink to={to} action={action} /></MemoryRouter>)

describe('moduleForPath', () => {
  it('resolves a subpage through its parent module, not the root', () => {
    // '/' is a nav entry, so a naive prefix match would claim every path. A
    // listed subpage is named as itself; its icon is still the module's.
    expect(moduleForPath('/inventory/warnings').label).toBe('Warnings')
    expect(moduleForPath('/inventory/warnings').icon).toBe(moduleForPath('/inventory').icon)
    expect(moduleForPath('/hr/drug-tests').label).toBe('Drug tests')
    expect(moduleForPath('/collection').label).toBe('Collect')
  })

  it('resolves a deep link carrying a query string', () => {
    expect(moduleForPath('/sales?record=abc').label).toBe('Sales')
  })

  it('knows Settings even though it has no nav entry of its own', () => {
    expect(moduleForPath('/settings').label).toBe('Settings')
    expect(moduleForPath('/settings/history').label).toBe('Settings')
  })

  it('gives the approvals queue its own mark, not the Settings one', () => {
    // It lives under /settings by URL but has its own rail entry, so a link
    // into it should carry the clipboard rather than the cog.
    expect(moduleForPath('/settings/approvals').label).toBe('Approvals')
  })

  it('falls back to Home rather than throwing on an unknown path', () => {
    expect(moduleForPath('/nowhere').label).toBe('Home')
  })
})

describe('ModuleLink', () => {
  it('keeps the destination in the accessible name once the words are gone', () => {
    const { getByRole } = at('/collection')
    expect(getByRole('link').getAttribute('aria-label')).toBe('Open Collect')
    expect(getByRole('link').getAttribute('data-tip')).toBe('Open Collect')
  })

  it('takes a verb for rows that do something other than open', () => {
    const { getByRole } = at('/settings/approvals', 'Review')
    expect(getByRole('link').getAttribute('aria-label')).toBe('Review Approvals')
  })

  it('can name a destination the module label does not describe', () => {
    // Input history sits under Settings, so it resolves to the Settings icon -
    // but "Open Settings" is not where the link goes, and a screen reader
    // should not be told that it is.
    const { getByRole } = render(
      <MemoryRouter><ModuleLink to="/settings/history" destination="Input history" /></MemoryRouter>,
    )
    expect(getByRole('link').getAttribute('aria-label')).toBe('Open Input history')
    expect(getByRole('link').getAttribute('data-tip')).toBe('Open Input history')
  })

  it('is the same borderless square as the row actions, carrying the arrow', () => {
    const { container } = at('/sales')
    expect(container.innerHTML).not.toContain('border-inputline')
    expect(container.querySelector('svg.go-arrow')).toBeTruthy()
  })

  it('points somewhere real', () => {
    const { getByRole } = at('/inventory/purchases')
    expect(getByRole('link').getAttribute('href')).toBe('/inventory/purchases')
  })

  /** The home page's Incoming card said "Open Stock" and landed on the
   *  purchases list; a subpage link is named after the subpage. */
  it('names a subpage link after the subpage', () => {
    const { getByRole } = render(<MemoryRouter><ModuleLink to="/inventory/purchases" /></MemoryRouter>)
    expect(getByRole('link').getAttribute('data-tip')).toBe('Open Purchases')
    cleanup()
    const root = render(<MemoryRouter><ModuleLink to="/inventory" /></MemoryRouter>)
    expect(root.getByRole('link').getAttribute('data-tip')).toBe('Open Stock')
  })
})
