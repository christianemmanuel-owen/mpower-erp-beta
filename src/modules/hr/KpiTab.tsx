import { useTables } from '../../lib/data'
import { useRange } from '../../lib/range'
import {
  Avatar, Card, Chip, DataTable, ExportButton, InfoTip, KpiStrip, Meter, td,
} from '../../components/ui'
import { fmtCompactPeso, fmtLiters } from '../../lib/format'
import { inRange, agentStats } from '../../lib/metrics'
import { entryReportDate, rateByCollector } from '../../lib/collection'
import { commissionWaiting, employeeDefaults } from '../../lib/payroll'
import { useHrConfig } from '../../lib/hrConfig'
import { exportTable } from '../../lib/exportXlsx'
import type { Personnel } from '../../data/types'

/**
 * KPI per user - Exhibit A 1.7, "drawing on Sales quota attainment and
 * Collection on-time percentage".
 *
 * Both halves come from the modules that own them rather than being recomputed
 * here: quota from `agentStats`, on-time from `rateByCollector`. That matters
 * because an employee's KPI must agree with what Sales and Collections show -
 * a manager comparing the two screens and finding different numbers will trust
 * neither.
 *
 * Not every employee has both. A driver has no quota and collects nothing; an
 * agent who never collects has quota only. Blanks are shown as "—" rather than
 * as zero, because a zero reads as failure and a blank reads as not applicable.
 *
 * One row per person rather than a card each. This is a screen for comparing
 * people - who is behind, who is carrying the quarter - and eleven cards in two
 * columns is the one layout where that comparison cannot be made: no column of
 * figures lines up with any other.
 */
export default function KpiTab() {
  const { range } = useRange()
  const { config } = useHrConfig()
  const data = useTables(['personnel', 'sales', 'agents'] as const)
  if (!data) return null
  const { personnel, sales, agents } = data

  const quota = new Map(agentStats(agents, sales, range).map((s) => [s.agent.id, s]))
  // Scoped to the same window as the quota half. It used to be a lifetime figure
  // sitting under a range picker: moving the picker changed one column and not the
  // other, and the export was filed under dates its on-time column ignored.
  const collection = new Map(
    rateByCollector(sales, Date.now(), (e) => inRange(entryReportDate(e), range))
      .map((r) => [r.key, r.rate]),
  )

  const pctText = (v: number | null | undefined) =>
    v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`

  /**
   * Neutral unless somebody has to do something about it.
   *
   * This used to run green at 90% and red under 70%, so a screen of people
   * doing their jobs was a screen of green - the same inversion the depot
   * gauges had, where the colour marked the normal case and the eye had
   * nowhere to land.
   */
  const behind = (v: number | null | undefined) => v !== null && v !== undefined && v < 0.7

  const waiting = (p: Personnel) =>
    p.agentId ? commissionWaiting(employeeDefaults(p, config), sales) : 0

  /** Employees who have something measurable - everyone else would be a row of
   * dashes, which is noise rather than information. */
  const rows = personnel
    .filter((p) => p.active !== false)
    .map((p) => ({
      person: p,
      quota: p.agentId ? quota.get(p.agentId) : undefined,
      collection: collection.get(p.id),
      held: waiting(p),
    }))
    .filter((r) => r.quota || r.collection)
    .sort((a, b) => (b.quota?.quotaProgress ?? 0) - (a.quota?.quotaProgress ?? 0))

  // The team, above the people. A list of individuals answers "how is Ana
  // doing" and never "how are we doing", which is the question a manager opens
  // this screen with.
  const measured = rows.filter((r) => r.quota)
  const teamVolume = measured.reduce((s, r) => s + (r.quota?.volume ?? 0), 0)
  const teamAttainment = measured.length > 0
    ? measured.reduce((s, r) => s + (r.quota?.quotaProgress ?? 0), 0) / measured.length
    : null
  const collectors = rows.filter((r) => r.collection?.onTimeRate != null)
  const teamOnTime = collectors.length > 0
    ? collectors.reduce((s, r) => s + (r.collection?.onTimeRate ?? 0), 0) / collectors.length
    : null
  const behindCount = measured.filter((r) => behind(r.quota?.quotaProgress)).length
  const heldTotal = rows.reduce((s, r) => s + r.held, 0)

  function exportKpi() {
    exportTable(
      `kpi-${range.from.slice(0, 10)}-to-${range.to.slice(0, 10)}`,
      'KPI per user',
      ['Employee', 'Role', 'Quota attainment %', 'Volume sold (L)', 'Rank',
       'Collected on time %', 'Settled', 'Bounced', 'Overdue', 'Commission awaiting collection'],
      rows.map((r) => [
        r.person.name,
        r.person.role,
        r.quota ? Math.round(r.quota.quotaProgress * 100) : null,
        r.quota?.volume ?? null,
        r.quota?.rank ?? null,
        r.collection?.onTimeRate === null || r.collection === undefined
          ? null
          : Math.round(r.collection.onTimeRate * 100),
        r.collection?.settled ?? null,
        r.collection?.bounced ?? null,
        r.collection?.openOverdue ?? null,
        r.held || null,
      ]),
    )
  }

  if (rows.length === 0) {
    return (
      <Card className="p-8 text-center text-[13px] text-faint" delay={100}>
        No sales quota or collection activity to measure in this period.
      </Card>
    )
  }

  return (
    <>
      <KpiStrip
        delay={60}
        items={[
          { label: 'Measured', value: rows.length, sub: `${measured.length} on quota · ${collectors.length} collecting` },
          { label: 'Team quota attainment', value: pctText(teamAttainment), sub: fmtLiters(Math.round(teamVolume)) },
          {
            label: 'Behind on quota',
            value: behindCount > 0 ? <span className="text-redtext">{behindCount}</span> : 0,
            sub: 'under 70% of quota',
          },
          { label: 'Collected on time', value: pctText(teamOnTime), sub: `${collectors.length} collector${collectors.length === 1 ? '' : 's'}` },
          {
            label: 'Commission held',
            value: heldTotal > 0 ? fmtCompactPeso(heldTotal) : '—',
            sub: 'earned, not yet collected',
          },
        ]}
      />

      <Card delay={120} className="mt-[18px]">
        <div className="flex flex-wrap items-center gap-[10px] border-b border-linesoft px-[14px] py-[10px]">
          <span className="font-meta text-[12px] text-mut">{rows.length} measured this period</span>
          <InfoTip label="Where these figures come from">
            Quota attainment is read from Sales and the on-time percentage from
            Collections, rather than recalculated here - so these agree with what
            those modules show. Both are scoped to the date range above.
          </InfoTip>
          <span className="ml-auto"><ExportButton onClick={exportKpi} /></span>
        </div>

        <DataTable
          cols={[
            { label: 'Employee' },
            { label: 'Quota attainment' },
            { label: 'Volume sold', align: 'right' },
            { label: 'Collected on time' },
            { label: 'Settled', align: 'right' },
            { label: 'Commission held', align: 'right' },
          ]}
          empty="Nobody has quota or collection activity in this period."
        >
          {rows.map((r) => (
            <tr key={r.person.id} className="hover:bg-hovrow">
              <td className={`${td} pl-[14px]`}>
                <span className="flex items-center gap-[10px]">
                  <Avatar name={r.person.name} tint="teal" size={26} />
                  <span className="min-w-0">
                    <p className="m-0 truncate font-semibold">{r.person.name}</p>
                    <p className="m-0 font-meta text-[12px] capitalize text-faint">{r.person.role}</p>
                  </span>
                  {/* Gated on volume: with no sales in the range every agent scores 0,
                      the sort is a no-op, and "#1 by volume" would just be whoever the
                      table returned first. */}
                  {r.quota && r.quota.rank <= 3 && r.quota.volume > 0 && (
                    <Chip status="neutral" text={`#${r.quota.rank}`} />
                  )}
                </span>
              </td>

              <td className={`${td} w-[184px]`}>
                {r.quota ? (
                  <>
                    <span className="flex items-baseline justify-between gap-2">
                      <span className={`tnum text-[13px] font-semibold ${behind(r.quota.quotaProgress) ? 'text-redtext' : ''}`}>
                        {pctText(r.quota.quotaProgress)}
                      </span>
                      {r.quota.quotaProgress >= 1 && (
                        <span className="font-meta text-[12px] text-mut">Met</span>
                      )}
                    </span>
                    {/* One bar, one meaning: the fill is the share of quota, and
                        it turns red only when somebody is far enough behind to
                        need a conversation. */}
                    <Meter
                      value={r.quota.quotaProgress}
                      max={1}
                      tone={behind(r.quota.quotaProgress) ? 'alert' : 'accent'}
                      className="mt-[6px]"
                    />
                  </>
                ) : (
                  <span className="font-meta text-[12px] text-faint">Not a sales agent</span>
                )}
              </td>

              <td className={`${td} tnum whitespace-nowrap text-right`}>
                {r.quota ? fmtLiters(Math.round(r.quota.volume)) : <span className="text-faint">—</span>}
              </td>

              <td className={`${td} w-[184px]`}>
                {r.collection?.onTimeRate != null ? (
                  <>
                    <span className={`tnum text-[13px] font-semibold ${behind(r.collection.onTimeRate) ? 'text-redtext' : ''}`}>
                      {pctText(r.collection.onTimeRate)}
                    </span>
                    <Meter
                      value={r.collection.onTimeRate}
                      max={1}
                      tone={behind(r.collection.onTimeRate) ? 'alert' : 'accent'}
                      className="mt-[6px]"
                    />
                  </>
                ) : (
                  <span className="font-meta text-[12px] text-faint">Collects nothing</span>
                )}
              </td>

              <td className={`${td} tnum whitespace-nowrap text-right`}>
                {r.collection ? (
                  <>
                    {r.collection.settled}
                    {r.collection.bounced > 0 && (
                      <span className="font-semibold text-redtext"> · {r.collection.bounced} bounced</span>
                    )}
                  </>
                ) : (
                  <span className="text-faint">—</span>
                )}
              </td>

              {/* Exhibit A 1.7 gates commission on collection. Showing what is
                  held back makes the gate legible instead of looking like an
                  underpayment - it was an amber banner inside each card, which
                  read as a warning about the person. */}
              <td className={`${td} tnum whitespace-nowrap pr-[14px] text-right`}>
                {r.held > 0
                  ? <span title="Earned but not payable until the sale is collected">{fmtCompactPeso(r.held)}</span>
                  : <span className="text-faint">—</span>}
              </td>
            </tr>
          ))}
        </DataTable>
      </Card>
    </>
  )
}
