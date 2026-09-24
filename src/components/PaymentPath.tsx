import type { ReactNode } from 'react'
import { Check, X } from 'lucide-react'
import type { CollectionStatus, PaymentMode } from '../data/types'

/**
 * The road a customer's payment travels, and whose stretch of it is whose.
 *
 *   Due ──▶ In hand ──▶ At the bank ──▶ Cleared
 *   └── Collect ──┘└──────── Treasury ────────┘
 *
 * This exists because the split between Collect and Treasury was correct and
 * invisible. Both modules showed figures from the whole road - Collect had an
 * "In hand" and a "Cleared" card, Treasury's queue was just a table - so a
 * reader could not tell which desk a payment was waiting on, or why there were
 * two modules at all. The rule is simple once it is drawn: the collector's job
 * ends when the money is in their hand; everything after that is the
 * treasurer's. So the same drawing appears at the top of both modules and on
 * every dialog that moves a payment, with the current stage lit.
 *
 * Cash and transfers skip stages - cash has no clearing to wait on, a transfer
 * is at the bank the moment it is sent - so the road is drawn shorter for
 * them rather than showing steps that will never light.
 */

type StageKey = 'due' | 'inHand' | 'atBank' | 'cleared'

interface StageDef { key: StageKey; label: string; desk: 'collection' | 'treasury' }

const STAGES: StageDef[] = [
  { key: 'due', label: 'Due', desk: 'collection' },
  { key: 'inHand', label: 'In hand', desk: 'collection' },
  { key: 'atBank', label: 'At the bank', desk: 'treasury' },
  { key: 'cleared', label: 'Cleared', desk: 'treasury' },
]

/** Which stages a payment of this kind actually passes through. */
export function stagesFor(mode?: PaymentMode): StageDef[] {
  // A transfer never passes through Treasury: whoever records it settles it.
  if (mode === 'bank_transfer') return STAGES.filter((s) => s.key === 'due' || s.key === 'cleared').map((s) => ({ ...s, desk: 'collection' as const }))
  if (mode === 'cash') return STAGES.filter((s) => s.key !== 'atBank')
  return STAGES
}

/** The stage a status sits at; bounced and cancelled report where they fell off. */
export function stageOfStatus(status: CollectionStatus, opts: { depositedAt?: string } = {}): StageKey {
  switch (status) {
    case 'pending': return 'due'
    case 'collected': return 'inHand'
    case 'deposited': return 'atBank'
    case 'cleared': return 'cleared'
    case 'bounced': return opts.depositedAt ? 'atBank' : 'inHand'
    case 'cancelled': return 'due'
  }
}

/**
 * Whose desk a payment is on right now. `null` once nothing more will happen.
 * Used by both modules to say "Handed to Treasury" / "Back with Collect"
 * rather than a bare status word.
 */
export function deskFor(status: CollectionStatus): 'collection' | 'treasury' | null {
  if (status === 'pending' || status === 'bounced') return 'collection'
  if (status === 'collected' || status === 'deposited') return 'treasury'
  return null
}

const DESK_LABEL = { collection: 'Collect', treasury: 'Treasury' } as const

/**
 * The strip.
 *
 * With `status` it marks one payment's position; without it, it is the
 * module's legend and lights nothing. `desk` names the module it is drawn in,
 * so the other half reads as somebody else's - which is the point.
 */
export default function PaymentPath({
  status, paymentMode, depositedAt, desk, size = 'md', bracket = true, className = '',
}: {
  status?: CollectionStatus
  paymentMode?: PaymentMode
  depositedAt?: string
  /** The module this is drawn in. Its own half is drawn stronger. */
  desk?: 'collection' | 'treasury'
  size?: 'sm' | 'md'
  /** The Collect / Treasury bracket underneath. Off where the surrounding
   * text already says whose desk it is - a dialog's rail, say. */
  bracket?: boolean
  className?: string
}) {
  const stages = stagesFor(paymentMode)
  const current = status ? stageOfStatus(status, { depositedAt }) : null
  const currentIx = current ? stages.findIndex((s) => s.key === current) : -1
  const dead = status === 'bounced' || status === 'cancelled'

  // Which stretch belongs to whom, for the bracket underneath. A transfer has
  // no Treasury stretch at all: it is settled by the person who records it.
  const firstTreasury = stages.findIndex((s) => s.desk === 'treasury')
  const brackets: { label: string; desk: 'collection' | 'treasury'; from: number; to: number }[] = []
  if (firstTreasury === -1) brackets.push({ label: DESK_LABEL.collection, desk: 'collection', from: 0, to: stages.length - 1 })
  else {
    brackets.push({ label: DESK_LABEL.collection, desk: 'collection', from: 0, to: firstTreasury - 1 })
    brackets.push({ label: DESK_LABEL.treasury, desk: 'treasury', from: firstTreasury, to: stages.length - 1 })
  }

  const sm = size === 'sm'
  const dot = sm ? 'h-[14px] w-[14px]' : 'h-[18px] w-[18px]'

  return (
    <div className={`tnum select-none ${className}`} aria-label={describe(status, paymentMode, current, stages)}>
      <ol className="m-0 flex list-none items-start p-0">
        {stages.map((s, i) => {
          const reached = currentIx >= 0 && i <= currentIx
          const here = i === currentIx
          const mine = !desk || s.desk === desk
          const last = i === stages.length - 1
          const tone = here && dead
            ? 'border-redf bg-redbadge text-redtext'
            : here
              ? 'border-ink bg-ink text-white'
              : reached
                ? 'border-tealbright bg-tealbadge text-tealtext'
                : mine ? 'border-inputline bg-white text-faint' : 'border-line bg-fill2 text-faint'
          return (
            <li key={s.key} className="relative flex min-w-0 flex-1 flex-col items-start">
              <div className="flex w-full items-center">
                <span
                  aria-hidden
                  className={`inline-flex ${dot} shrink-0 items-center justify-center rounded-full border-[1.5px] font-meta text-[9px] font-bold ${tone}`}
                >
                  {here && dead ? <X size={sm ? 8 : 10} strokeWidth={3} /> : reached && !here ? <Check size={sm ? 8 : 10} strokeWidth={3} /> : i + 1}
                </span>
                {!last && (
                  <span
                    aria-hidden
                    className={`mx-[4px] h-[1.5px] min-w-[10px] flex-1 ${currentIx > i ? 'bg-tealbright' : mine ? 'bg-inputline' : 'bg-line'}`}
                  />
                )}
              </div>
              <span
                className={`mt-[4px] whitespace-nowrap font-meta ${sm ? 'text-[10px]' : 'text-[11px]'} ${
                  here ? 'font-bold text-ink' : reached ? 'font-semibold text-tealtext' : mine ? 'font-semibold text-sec' : 'text-faint'
                } ${last ? '' : 'pr-[6px]'}`}
              >
                {here && dead ? (status === 'bounced' ? 'Bounced' : 'Cancelled') : s.label}
              </span>
            </li>
          )
        })}
      </ol>
      {/* The bracket: which desk owns which stretch. */}
      {bracket && <ol className="m-0 mt-[6px] flex list-none gap-[6px] p-0" aria-hidden>
        {brackets.map((b) => {
          const mine = !desk || b.desk === desk
          return (
            <li key={b.desk} className="flex flex-col" style={{ flex: `${b.to - b.from + 1} 1 0%` }}>
              <span className={`h-[3px] rounded-full ${mine ? (b.desk === 'treasury' ? 'bg-ink' : 'bg-tealbright') : 'bg-line'}`} />
              <span className={`mt-[3px] font-meta text-[10px] font-semibold uppercase tracking-[.08em] ${mine ? 'text-lab' : 'text-faint'}`}>
                {b.label}
              </span>
            </li>
          )
        })}
      </ol>}
    </div>
  )
}

function describe(status: CollectionStatus | undefined, mode: PaymentMode | undefined, current: StageKey | null, stages: StageDef[]): string {
  const road = stages.map((s) => s.label).join(' then ')
  if (!status || !current) return `A ${mode ?? 'check'} payment goes ${road}. Collect takes it as far as in hand; Treasury takes it the rest of the way.`
  const at = stages.find((s) => s.key === current)
  return `${status === 'bounced' ? 'Bounced' : status === 'cancelled' ? 'Cancelled' : `At ${at?.label.toLowerCase()}`} on the road ${road}.`
}

/**
 * The one-line version for a table cell or a card: "Handed to Treasury",
 * "With Collect", "Cleared". Says whose desk it is on, which is the question
 * the status word never answered.
 */
export function DeskNote({ status, paymentMode, className = '' }: { status: CollectionStatus; paymentMode?: PaymentMode; className?: string }): ReactNode {
  const desk = deskFor(status)
  const text = status === 'cleared' ? 'Cleared'
    : status === 'cancelled' ? 'Cancelled'
      : status === 'bounced' ? 'Bounced · back with Collect'
        : desk === 'treasury' ? (paymentMode === 'cash' ? 'Cash handed to Treasury' : status === 'deposited' ? 'At the bank · Treasury' : 'Handed to Treasury')
          : 'To collect'
  return <span className={`font-meta text-[11px] font-semibold ${desk === 'treasury' ? 'text-tealtext' : status === 'bounced' ? 'text-redtext' : 'text-mut'} ${className}`}>{text}</span>
}
