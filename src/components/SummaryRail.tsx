import type { ReactNode } from 'react'

/**
 * The figures column beside a form, written as a receipt.
 *
 * It used to state a position and then judge it in prose - "46,000 L room",
 * "28,000 L after", "It fits." - and the sentence was doing work the numbers
 * should do themselves. Worse, it only ever said the two ends: what the depot
 * held before and after, with the thing in between (the order itself) left for
 * the reader to subtract.
 *
 * A receipt says all three: what you had, what this changes, what you are left
 * with. Then "it fits" is not an opinion anyone has to write down - a positive
 * closing line is what fitting looks like, and a negative one is what it looks
 * like when it does not.
 */

export function RailSection({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-[18px] last:mb-0">
      <p className="m-0 mb-[8px] font-meta text-[10px] font-semibold uppercase tracking-[.09em] text-mut">
        {title}
      </p>
      {children}
    </section>
  )
}

/** An opening position, or any plain figure. */
export function RailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[4px]">
      <span className="font-meta text-[12px] text-mut">{label}</span>
      <span className="tnum text-[13px] text-lab">{value}</span>
    </div>
  )
}

/**
 * What this record changes - the middle line of the receipt.
 *
 * The sign is rendered rather than baked into the value so a caller passes a
 * plain positive figure and says which way it moves. Reading "18,000 L" on a
 * line between 46,000 and 28,000 invites the wrong arithmetic.
 */
export function RailDelta({ label, value, sign }: { label: string; value: ReactNode; sign: '+' | '-' }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[4px]">
      <span className="font-meta text-[12px] text-mut">{label}</span>
      <span className="tnum text-[13px] text-lab">
        <span className="text-mut">{sign === '-' ? '−' : '+'}</span>{value}
      </span>
    </div>
  )
}

/**
 * The closing line: what you are left with once this record is applied.
 *
 * `tone="bad"` is for a close that cannot stand - more than the depot holds,
 * money still unaccounted for. It is the only colour in the rail.
 */
export function RailClose({ label, value, tone = 'plain' }: {
  label: string
  value: ReactNode
  tone?: 'plain' | 'bad'
}) {
  return (
    <div className="mt-[6px] flex items-baseline justify-between gap-3 border-t border-line pt-[8px]">
      <span className="font-meta text-[12px] text-mut">{label}</span>
      <span className={`tnum text-[13px] font-semibold ${tone === 'bad' ? 'text-redtext' : 'text-ink'}`}>
        {value}
      </span>
    </div>
  )
}

/** The money headline. One per rail - a second 20px figure competes with it. */
export function RailTotal({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="mt-[6px] flex items-baseline justify-between gap-3 border-t border-line pt-[10px]">
      <span className="font-meta text-[12px] text-mut">{label}</span>
      <span className="tnum text-[20px] font-semibold leading-[1.15] text-ink">{value}</span>
    </div>
  )
}

/**
 * A short line under a section, for the thing the figures cannot say.
 *
 * Unboxed on purpose: the bordered note this replaces was a panel drawn around
 * one sentence, and there is now a closing figure above it carrying the state.
 * This is only for what the reader has to do about it.
 */
export function RailAside({ tone = 'plain', children }: { tone?: 'plain' | 'bad'; children: ReactNode }) {
  return (
    <p className={`m-0 mt-[6px] font-meta text-[12px] leading-[1.45] ${tone === 'bad' ? 'text-redtext' : 'text-mut'}`}>
      {children}
    </p>
  )
}
