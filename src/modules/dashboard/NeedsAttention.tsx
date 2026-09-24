import { todayISO } from '../../lib/format'
import { Card } from '../../components/ui'
import { useOpenRecord } from '../../lib/peek'
import { GoArrow } from '../../components/ModuleLink'
import { moduleForPath } from '../../lib/nav'
import { useAuth } from '../../lib/auth'
import { useApprovals } from '../../lib/approvals'
import { attentionRows, type AttentionRow } from './attention'
import type {
  Customer, Delivery, Personnel, Product, Purchase, Sale, StockThreshold, Warehouse,
} from '../../data/types'

/**
 * Needs attention - the one block on Home that reads across every module.
 *
 * Home used to answer "how are we doing" four times and "what needs me" not at
 * all: overdue money lived on Cash flow, short depots on Operations, parked
 * inputs on Activity. Someone opening the app at seven in the morning had to
 * visit three tabs to find out whether anything was wrong.
 *
 * Two rules hold the block together.
 *
 * **Rows are records, not notifications.** Every line names something real and
 * links to it. Nothing here is dismissible, because nothing here is a message -
 * a row leaves when the thing it describes is dealt with, which is the only
 * honest way for a list like this to empty.
 *
 * **Urgency is a heading, not a colour.** Act now is money already late and
 * stock already short. Today is work that will go wrong if nobody touches it by
 * this evening. Two headings beat seven equally-weighted rows, and they beat
 * seven coloured dots.
 *
 * The headings took that literally only halfway: they said it in words and then
 * said it again in red and amber, above rows whose figures were red and amber
 * too. The words stay, the hues come off them. Red survives in one place on
 * this card - the figure on an Act now row, which is the number someone has to
 * do something about. Amber is gone from the dashboard entirely; it had drifted
 * onto ordinary states (a depot merely full, a trip merely due today) until it
 * meant nothing more than "this row exists".
 */

const GROUPS: { key: 'act' | 'today'; label: string; cls: string }[] = [
  { key: 'act', label: 'Act now', cls: 'text-sec' },
  { key: 'today', label: 'Today', cls: 'text-faint' },
]

const toneCls: Record<AttentionRow['tone'], string> = {
  act: 'text-redtext',
  watch: 'text-sec',
  plain: 'text-sec',
}

export default function NeedsAttentionCard(props: {
  sales: Sale[]
  purchases: Purchase[]
  deliveries: Delivery[]
  customers: Customer[]
  personnel: Personnel[]
  warehouses: Warehouse[]
  products: Product[]
  stockThresholds: StockThreshold[]
}) {
  const { seat } = useAuth()
  const openRecord = useOpenRecord()
  // Only an approver has anything to do about a parked input, so only an
  // approver is asked about them. A seat that cannot decide gets [] and the
  // row never appears.
  const { data: approvals } = useApprovals('pending', false)
  const mayApprove = !!seat?.isAdmin

  const rows = attentionRows({
    ...props,
    approvals: mayApprove ? (approvals?.rows ?? []) : [],
    today: todayISO(),
  })

  return (
    <Card>
      <div className="flex items-center gap-[10px] border-b border-linesoft bg-paper px-[14px] py-[10px]">
        <span className="text-[13px] font-semibold">Needs attention</span>
{rows.length > 0 && <span className="font-meta text-[12px] text-faint">{rows.length}</span>}
      </div>

      {rows.length === 0 && (
        // Worth seeing, rather than a fallback. The whole point of the block is
        // that it can be empty and that means something.
        <p className="m-0 px-[14px] py-7 text-center text-[13px] text-faint">
          Nothing needs you. No overdue collections, no depot below its level, nothing waiting on a decision.
        </p>
      )}

      {/* Built as a list of the groups that actually have rows, so the first
          one visible can be told from the rest - "Today" leading an empty
          "Act now" should not draw a rule against the card header. */}
      {GROUPS
        .map((g) => ({ ...g, group: rows.filter((r) => r.group === g.key) }))
        .filter((g) => g.group.length > 0)
        .map(({ key, label, cls, group }, i) => {
        return (
          <div key={key}>
            {/* The heading sat on white with a single hairline under it, which
                is exactly a row - so "TODAY" read as another line of the list
                rather than as the break between two of them. On the paper
                ground, ruled top and bottom, it reads as a divider. */}
            <p className={`m-0 border-b border-linesoft bg-paper px-[14px] py-[6px] font-meta text-[10px] font-semibold uppercase tracking-[.09em] ${i > 0 ? 'border-t' : ''} ${cls}`}>
              {label}
            </p>
            {group.map((r) => (
              <div
                key={r.key}
                role="link"
                tabIndex={0}
                aria-label={`${r.cta ?? 'Open'} ${moduleForPath(r.href).label}: ${r.title}`}
                onClick={() => openRecord(r.href)}
                onKeyDown={(e) => { if (e.key === 'Enter') openRecord(r.href) }}
                className="group flex cursor-pointer items-center gap-3 border-b border-linesoft px-[14px] py-[9px] transition-colors last:border-0 hover:bg-paper focus:outline-none focus-visible:bg-paper"
              >
                <span className="w-[74px] shrink-0 font-meta text-[12px] text-mut">{r.tag}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold leading-[1.35]">{r.title}</span>
                  <span className="mt-[1px] block font-meta text-[12px] text-mut">{r.detail}</span>
                </span>
                {/* Two columns, not one cell holding both. How long and how much
                    are different questions, and glued together as
                    "P950,220 - 43 days over" neither one could line up with the
                    row above it. Fixed widths so the figures form a column even
                    when a row has only one of them. */}
                <span className="tnum w-[104px] shrink-0 whitespace-nowrap text-right font-meta text-[12px] text-mut">
                  {r.age}
                </span>
                <span className={`tnum w-[124px] shrink-0 whitespace-nowrap text-right font-meta text-[12px] font-semibold ${toneCls[r.tone]}`}>
                  {r.value}
                </span>
                {/* The whole row goes there; the arrow fades in on hover to say
                    so, and where it goes is in the row's accessible name. */}
                <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center text-faint opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden>
                  <GoArrow />
                </span>
              </div>
            ))}
          </div>
        )
      })}
    </Card>
  )
}
