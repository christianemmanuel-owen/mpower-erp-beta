import { RecordLink } from '../../lib/peek'
import { ModuleLink } from '../../components/ModuleLink'
import { Avatar, Card, Chip } from '../../components/ui'
import { useAudit } from '../../lib/approvals'
import { recordHref } from '../../lib/deepLink'
import { label } from '../../lib/format'
import type { ActivityEvent } from '../../lib/metrics'

/**
 * Recent activity, now with who did it.
 *
 * The card has always answered "what happened" and never "who did it", because
 * records carry no author: a Sale knows its agent, not the person who typed it.
 * The audit log does know, so the actor is joined in from there on the record's
 * create entry.
 *
 * Two things follow from where that name comes from. It is the person who
 * entered the record, not the agent credited with the sale - those are
 * different people and conflating them would misattribute commission. And the
 * audit endpoint scopes non-admins to their own rows, so a non-admin sees names
 * on their own entries and none on anyone else's. That is the privacy rule
 * doing its job, so an unknown actor renders as nothing rather than as a
 * placeholder implying the record entered itself.
 */

export interface ActivityLine {
  text: string
  meta: string
  status: string
}

const TBL_FOR: Record<ActivityEvent['kind'], string> = {
  purchase: 'purchases',
  sale: 'sales',
  delivery: 'deliveries',
}

export default function ActivityCard({ activity, lineFor, fmtAgo }: {
  activity: ActivityEvent[]
  lineFor: (e: ActivityEvent) => ActivityLine | null
  fmtAgo: (t: number) => string
}) {
  // One request covering every row on screen. 'create' only: an edit tells you
  // who touched it last, which is a different question and belongs in the
  // record's own history.
  const { data } = useAudit({ action: 'create', limit: 120 })
  const actorOf = new Map<string, string>()
  for (const row of data?.rows ?? []) {
    const key = `${row.tbl}:${row.recordId}`
    if (!actorOf.has(key)) actorOf.set(key, row.seatName)
  }

  return (
    <Card>
      <div className="flex items-center gap-[10px] border-b border-linesoft bg-paper px-[14px] py-[10px]">
        <span className="text-[13px] font-semibold">Recent activity</span>
        {/* The only link to Input history anywhere in the app - the page was
            built and reachable only by typing the URL. It carries the Settings
            icon, because that is where the page lives, but names itself in the
            hover and the accessible name rather than claiming to be Settings. */}
        <ModuleLink to="/settings/history" destination="Input history" className="ml-auto" />
      </div>

      {activity.length === 0 && (
        <p className="m-0 px-[14px] py-7 text-center text-[13px] text-faint">No recent activity.</p>
      )}

      {activity.map((e) => {
        const line = lineFor(e)
        if (!line) return null
        const tbl = TBL_FOR[e.kind]
        const href = recordHref(tbl, e.id)
        const actor = actorOf.get(`${tbl}:${e.id}`)
        return (
          <div key={e.id} className="flex items-center gap-[10px] border-b border-linesoft px-[14px] py-[9px] last:border-0">
            {/* An avatar where the actor is known, a neutral placeholder where
                it is not, so the rows keep one left edge either way. */}
            {actor
              ? <Avatar name={actor} size={24} />
              : <span className="h-[24px] w-[24px] shrink-0 rounded-full border border-dashed border-inputline" />}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold">
                {href ? <RecordLink to={href} className="text-ink hover:underline">{line.text}</RecordLink> : line.text}
              </span>
              <span className="mt-[1px] block truncate font-meta text-[12px] text-mut">
                {actor ? `${actor} · ` : ''}{line.meta}
              </span>
            </span>
            <Chip status={line.status} text={label(line.status)} />
            <span className="w-[46px] shrink-0 whitespace-nowrap text-right font-meta text-[12px] text-faint">
              {fmtAgo(e.t)}
            </span>
          </div>
        )
      })}
    </Card>
  )
}
