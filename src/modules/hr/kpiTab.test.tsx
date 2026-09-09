// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { DEFAULT_HR_CONFIG } from '../../data/statutory'
import type { Personnel, Sale } from '../../data/types'

const RANGE = { from: '2026-09-01', to: '2026-09-30' }

const sale = (agentId: string, volumeLiters: number): Sale => ({
  id: `s-${agentId}-${volumeLiters}`, createdAt: '', updatedAt: '',
  customerId: 'c1', agentId, date: '2026-09-05', status: 'fulfilled',
  volumeLiters, pricePerLiter: 56, installments: [],
} as unknown as Sale)

const personnel = [
  // Ahead: 30,000 L against a 20,000 L monthly quota.
  { id: 'p1', name: 'A. Reyes', role: 'sales', active: true, agentId: 'ag1' },
  // Behind: 4,000 L against 20,000 L.
  { id: 'p2', name: 'B. Cruz', role: 'sales', active: true, agentId: 'ag2' },
  // Neither an agent nor a collector: not measurable, so not listed at all.
  { id: 'p3', name: 'C. Lim', role: 'driver', active: true },
] as unknown as Personnel[]

vi.mock('../../lib/data', () => ({
  useTables: () => ({
    personnel,
    sales: [sale('ag1', 30_000), sale('ag2', 4_000)],
    agents: [
      { id: 'ag1', name: 'A. Reyes', monthlyQuotaLiters: 20_000 },
      { id: 'ag2', name: 'B. Cruz', monthlyQuotaLiters: 20_000 },
    ],
  }),
}))
vi.mock('../../lib/range', () => ({ useRange: () => ({ range: RANGE }) }))
vi.mock('../../lib/hrConfig', () => ({ useHrConfig: () => ({ config: DEFAULT_HR_CONFIG }) }))

import KpiTab from './KpiTab'

afterEach(cleanup)

describe('Performance', () => {
  /** A list of individuals answers "how is Ana doing" and never "how are we
   *  doing", which is the question a manager opens this screen with. */
  it('leads with the team, then the people', () => {
    render(<KpiTab />)
    expect(screen.getByText('Team quota attainment')).toBeTruthy()
    expect(screen.getByText('Behind on quota')).toBeTruthy()

    // One of the two agents is under 70% of quota.
    const behind = screen.getByText('Behind on quota').closest('div')!
    expect(within(behind).getByText('1')).toBeTruthy()
  })

  it('lists only people with something to measure', () => {
    render(<KpiTab />)
    expect(screen.getByRole('row', { name: /A\. Reyes/ })).toBeTruthy()
    expect(screen.queryByRole('row', { name: /C\. Lim/ })).toBeNull()
  })

  /**
   * Attainment used to run green at 90% and red under 70%, so a screen of
   * people doing their jobs was a screen of green and the eye had nowhere to
   * land. Neutral unless somebody is far enough behind to need a conversation.
   */
  it('marks a met quota quietly and a shortfall in red', () => {
    render(<KpiTab />)
    const ahead = within(screen.getByRole('row', { name: /A\. Reyes/ }))
    expect(ahead.getByText('Met')).toBeTruthy()
    expect(ahead.getByText('150%').className).not.toContain('text-redtext')

    const short = within(screen.getByRole('row', { name: /B\. Cruz/ }))
    expect(short.getByText('20%').className).toContain('text-redtext')
    expect(short.queryByText('Met')).toBeNull()
  })
})
