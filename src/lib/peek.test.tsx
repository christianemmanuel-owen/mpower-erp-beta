// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { PeekProvider, peekTarget, usePeek } from './peek'
import { ModuleLink } from '../components/ModuleLink'

/**
 * A record link opens the record where you stand; a list link, a modified
 * click, or a page with no peek provider still navigates.
 */
describe('peekTarget', () => {
  it('recognises the record drawers and nothing else', () => {
    expect(peekTarget('/sales?record=abc')).toEqual({ tbl: 'sales', id: 'abc' })
    expect(peekTarget('/inventory/purchases?record=p%3A1')).toEqual({ tbl: 'purchases', id: 'p:1' })
    expect(peekTarget('/logistics?record=d1')).toEqual({ tbl: 'deliveries', id: 'd1' })
    expect(peekTarget('/collection?record=s%3A%3Ai')).toEqual({ tbl: 'collection', id: 's::i' })
    expect(peekTarget('/sales')).toBeNull()
    expect(peekTarget('/accounts?record=c1')).toBeNull()
  })
})

function Where() {
  const { pathname } = useLocation()
  const peek = usePeek()
  return <p>at {pathname} · peek {peek?.peek ? `${peek.peek.tbl}/${peek.peek.id}` : 'none'}</p>
}

describe('ModuleLink', () => {
  afterEach(cleanup)
  const view = (withPeek: boolean) => render(
    <MemoryRouter initialEntries={['/settings/history']}>
      {withPeek ? (
        <PeekProvider><Routes><Route path="*" element={<><ModuleLink to="/sales?record=s1" destination="the record" /><ModuleLink to="/sales" /><Where /></>} /></Routes></PeekProvider>
      ) : (
        <Routes><Route path="*" element={<><ModuleLink to="/sales?record=s1" destination="the record" /><Where /></>} /></Routes>
      )}
    </MemoryRouter>,
  )

  it('peeks a record link and stays on the page', () => {
    view(true)
    fireEvent.click(screen.getByRole('link', { name: 'Open the record' }))
    expect(screen.getByText('at /settings/history · peek sales/s1')).toBeTruthy()
  })

  it('still navigates for a list link, and for a modified click', () => {
    view(true)
    fireEvent.click(screen.getByRole('link', { name: 'Open Sales' }))
    expect(screen.getByText('at /sales · peek none')).toBeTruthy()
    cleanup(); view(true)
    fireEvent.click(screen.getByRole('link', { name: 'Open the record' }), { metaKey: true })
    expect(screen.getByText(/peek none/)).toBeTruthy()
  })

  it('navigates when there is no peek provider at all', () => {
    view(false)
    fireEvent.click(screen.getByRole('link', { name: 'Open the record' }))
    expect(screen.getByText('at /sales · peek none')).toBeTruthy()
  })
})
