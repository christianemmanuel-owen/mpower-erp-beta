import { useMemo } from 'react'
import { Card } from '../../components/ui'
import Planner from '../../components/Planner'
import { plannerEvents } from '../../lib/planner'
import type { Customer, Personnel, Sale } from '../../data/types'

/**
 * Collect's month: what is due to be collected, and nothing else - the same
 * grid as Home's calendar with one layer on. Clicking an entry opens the
 * settle dialog on that installment (via the record link), so marking one
 * collected from here still asks for the date the money actually arrived.
 */
export default function CalendarTab({ sales, customers, personnel }: {
  sales: Sale[]
  customers: Customer[]
  personnel: Personnel[]
}) {
  const events = useMemo(() => plannerEvents({ sales, customers, personnel }, ['in']), [sales, customers, personnel])
  return (
    <Card className="p-[14px]" delay={150}>
      <Planner events={events} layers={['in']} activeLayers={['in']} />
    </Card>
  )
}
