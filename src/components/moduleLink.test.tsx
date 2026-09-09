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
    // '/' is a nav entry, so a naive prefix match would claim every path.
    expect(moduleForPath('/inventory/warnings').label).toBe('Stock')
    expect(moduleForPath('/hr/drug-tests').label).toBe('HR')
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
    expect(getByRole('link').getAttribute('title')).toBe('Open Collect')
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
    expect(getByRole('link').getAttribute('title')).toBe('Open Input history')
  })

  it('is drawn as a bordered control, which is what reads as clickable', () => {
    // A bare glyph does not announce itself as a button - none of the products
    // surveyed ship one for navigation.
    const { container } = at('/sales')
    expect(container.innerHTML).toContain('border-inputline')
  })

  it('points somewhere real', () => {
    const { getByRole } = at('/inventory/purchases')
    expect(getByRole('link').getAttribute('href')).toBe('/inventory/purchases')
  })
})
