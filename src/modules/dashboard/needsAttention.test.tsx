// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { AttentionRow } from './attention'

const rows: AttentionRow[] = [
  {
    key: 'a', group: 'act', tag: 'Collection', title: '2 overdue installments',
    detail: 'Nova Fuels Inc.', age: '43 days over', value: '₱950,220', tone: 'act',
    href: '/collection', cta: 'Open',
  },
  {
    key: 'b', group: 'today', tag: 'Sales', title: '3 confirmed sales with no delivery scheduled',
    detail: 'Oldest confirmed Jul 15, 2026', age: '58 days waiting', value: '19,000 L', tone: 'plain',
    href: '/sales', cta: 'Open',
  },
]

vi.mock('./attention', async (original) => ({
  ...(await original<typeof import('./attention')>()),
  attentionRows: () => rows,
}))
vi.mock('../../lib/auth', async (original) => ({
  ...(await original<typeof import('../../lib/auth')>()),
  useAuth: () => ({ seat: { id: 's1', isAdmin: true }, ready: true, login: async () => null, logout: () => {} }),
}))
vi.mock('../../lib/approvals', async (original) => ({
  ...(await original<typeof import('../../lib/approvals')>()),
  useApprovals: () => ({ data: { rows: [] } }),
}))

import NeedsAttention from './NeedsAttention'

afterEach(cleanup)

describe('Needs attention', () => {
  /**
   * The group heading sat on white with one hairline under it - the same shape
   * as a row - so "Today" read as another line of the list rather than as the
   * break between two of them.
   */
  it('sets its group headings apart from the rows', () => {
    // The rows are stubbed above, so the tables only need to exist.
    render(
      <MemoryRouter>
        <NeedsAttention
          sales={[]} purchases={[]} deliveries={[]} customers={[]}
          personnel={[]} warehouses={[]} products={[]} stockThresholds={[]}
        />
      </MemoryRouter>,
    )
    const today = screen.getByText('Today')
    expect(today.className).toContain('bg-paper')
    // Ruled above as well as below, because it divides two groups.
    expect(today.className).toContain('border-t')

    // The first heading has the card header directly above it and needs no rule.
    expect(screen.getByText('Act now').className).not.toContain('border-t')
  })
})
