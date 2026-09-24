// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { TopAgentsCard } from './CashFlowCards'
import type { AgentStat } from '../../lib/metrics'
import type { Agent } from '../../data/types'

afterEach(cleanup)

const stat = (name: string, volume: number, revenue: number, quota: number): AgentStat => ({
  agent: { id: name, name } as Agent,
  volume,
  revenue,
  quota,
  quotaProgress: quota > 0 ? volume / quota : 0,
  rank: 0,
})

/**
 * Three agents chosen so that no two measures agree on the order.
 *
 * Bea moved the most litres, Carlo earned the most pesos on fewer of them, and
 * Ana is furthest through a small quota. Whichever basis the card is on, the
 * other two are wrong - which is the point: the card used to sort by one and
 * print another, so a row could sit above a row with a higher number on it.
 */
const stats = [
  stat('Ana', 20_000, 1_000_000, 20_000),
  stat('Bea', 60_000, 3_000_000, 90_000),
  stat('Carlo', 40_000, 3_400_000, 90_000),
]

function card(rows = stats) {
  const { container } = render(<MemoryRouter><TopAgentsCard stats={rows} /></MemoryRouter>)
  // The name is the bold truncating span; the litres line truncates too.
  const order = () => [...container.querySelectorAll('.truncate.font-semibold')].map((el) => el.textContent)
  const rankBy = (label: string) =>
    fireEvent.change(screen.getByLabelText('Rank agents by'), { target: { value: label } })
  return { container, order, rankBy }
}

describe('the top agents card', () => {
  it('ranks by volume out of the box, highest first', () => {
    expect(card().order()).toEqual(['Bea', 'Carlo', 'Ana'])
  })

  it('reorders when asked to rank by revenue', () => {
    const c = card()
    c.rankBy('revenue')
    expect(c.order()).toEqual(['Carlo', 'Bea', 'Ana'])
  })

  it('reorders when asked to rank by quota progress', () => {
    const c = card()
    c.rankBy('quota')
    // Ana is at 100% of 20,000 L; Bea 67%, Carlo 44%.
    expect(c.order()).toEqual(['Ana', 'Bea', 'Carlo'])
  })

  /**
   * The percentage is meaningless without the litres behind it: quotas here
   * differ by agent and are prorated to the range, so 67% is not comparable
   * work to another agent's 67%.
   */
  it('prints the quota each percentage is measured against', () => {
    const c = card()
    const row = [...c.container.querySelectorAll('.truncate.font-semibold')]
      .find((el) => el.textContent === 'Bea')!.closest('div')!
    expect(within(row).getByText('67%')).toBeTruthy()
    expect(within(row).getByText(/of 90,000/)).toBeTruthy()
  })

  it('refuses to rank a period in which nobody sold anything', () => {
    card([stat('Ana', 0, 0, 20_000), stat('Bea', 0, 0, 90_000)])
    expect(screen.getByText(/nothing to rank/)).toBeTruthy()
  })
})
