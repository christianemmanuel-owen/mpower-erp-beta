import { checklistProgress, documentsFor, movementType, needsChecklist } from './logistics'
import type { Delivery, DeliveryStatus, ID, MovementType, Seat, StageStamp, TripStage } from '../data/types'

/**
 * A trip as a sequence of handoffs.
 *
 * The trip form used to be one flat list of sections, every one of them equally
 * editable at every moment, which said that a trip is a form to fill in. It is
 * not: office staff book it, the crew sign the checklist on paper before the
 * truck leaves, someone takes the signed receipt at the far end, and someone
 * closes it out. The stages here are that sequence, derived from the status the
 * app already keeps rather than added beside it, so there is exactly one answer
 * to "where is this trip" and no second field to keep in step.
 *
 * `owner` is a label, not a permission. Crew have no seats and cannot sign in
 * (see StageStamp), so today every stage is recorded by an office seat; saying
 * whose work it is stops the form from implying that the person typing is the
 * person who checked the tires.
 */
export interface StageDef {
  key: TripStage
  title: string
  owner: string
  /** The status a trip is in while this stage is the one being worked on. */
  status: DeliveryStatus | DeliveryStatus[]
}

export const TRIP_STAGES: readonly StageDef[] = [
  { key: 'plan', title: 'Plan', owner: 'Logistics', status: 'scheduled' },
  { key: 'dispatch', title: 'Dispatch', owner: 'Crew, on paper', status: 'loading' },
  { key: 'delivery', title: 'Delivery', owner: 'Driver or office', status: 'in_transit' },
  { key: 'close', title: 'Close', owner: 'Office', status: ['delivered', 'failed'] },
] as const

const ORDER: TripStage[] = TRIP_STAGES.map((s) => s.key)

/** Which stage a trip is working on now. */
export function stageOf(status: DeliveryStatus): TripStage {
  const found = TRIP_STAGES.find((s) => (Array.isArray(s.status) ? s.status.includes(status) : s.status === status))
  return found?.key ?? 'plan'
}

export type StageState = 'done' | 'now' | 'later'

/**
 * Done, now, or later - by position, not by whether the fields are filled.
 *
 * A stage the trip has moved past is done even if something in it is blank,
 * because the trip demonstrably went ahead: pretending otherwise would put a
 * "todo" mark on a truck that left three hours ago. What is missing from a
 * passed stage is said in that stage, not in its heading.
 */
export function stageState(stage: TripStage, status: DeliveryStatus): StageState {
  const here = ORDER.indexOf(stageOf(status))
  const mine = ORDER.indexOf(stage)
  if (mine < here) return 'done'
  return mine === here ? 'now' : 'later'
}

/** The document slot that carries the signature at the far end, per movement. */
const RECEIPT_SLOTS: Record<MovementType, string> = {
  delivery_to_client: 'deliveryReceipt',
  pickup_from_client: 'signedReceipt',
  pickup_from_depot: 'supplierReceipt',
  delivery_from_depot: 'supplierDeliveryReceipt',
}

export const receiptSlot = (d: Delivery) => RECEIPT_SLOTS[movementType(d)]

/**
 * Which stage each of the movement's documents belongs to.
 *
 * The loading slips are made when the truck is loaded and the receipt is signed
 * when it arrives, so filing them in one "Documents" block put the end of the
 * trip above the middle of it. The pre-dispatch checklist is filled in rather
 * than filed, so it is not in either list.
 */
export function documentSlots(d: Delivery): { dispatch: string[]; delivery: string[] } {
  const receipt = receiptSlot(d)
  const all = documentsFor(d).filter((s) => s !== 'preDispatchChecklist')
  return {
    // The delivery receipt is issued at dispatch and rides with the load; it
    // returns signed. Both stages show its slot: dispatch for the number,
    // delivery for the signed scan.
    dispatch: all.filter((s) => s !== receipt || movementType(d) === 'delivery_to_client'),
    delivery: all.filter((s) => s === receipt),
  }
}

/**
 * What a stage still wants before the trip moves on.
 *
 * Reported, never enforced. A truck leaves before the paperwork is typed, and a
 * hard block on that only teaches people to enter fiction to get past it - so
 * the action stays live and this is what it says beside itself.
 */
export function stageGaps(d: Delivery, stage: TripStage, receiptOnFile: boolean): string[] {
  if (stage === 'plan') {
    return [
      !d.truckId ? 'a truck' : null,
      !d.driverId ? 'a driver' : null,
      !d.scheduleDate ? 'a scheduled date' : null,
    ].filter((x): x is string => x !== null)
  }
  if (stage === 'dispatch') {
    // The receipt goes out with the truck - its number is part of getting
    // ready, not of coming back. Only the signing happens at the far end.
    const out: string[] = []
    if (movementType(d) === 'delivery_to_client' && !d.documents?.[receiptSlot(d)]?.referenceNo) out.push('a delivery receipt number')
    if (needsChecklist(d)) {
      const progress = checklistProgress(d.checklist)
      if (!progress.complete) out.push(`${progress.outstanding.length} checklist item${progress.outstanding.length === 1 ? '' : 's'}`)
      if (!progress.signed) out.push('the crew signatures')
    }
    return out
  }
  if (stage === 'delivery') {
    return [
      movementType(d) !== 'delivery_to_client' && !d.documents?.[receiptSlot(d)]?.referenceNo ? 'a receipt number' : null,
      !d.receivedBy ? 'who signed' : null,
      !receiptOnFile ? 'the signed copy' : null,
    ].filter((x): x is string => x !== null)
  }
  return []
}

/** "Delivery receipt number", "17 checklist items" - each gap as a short
 *  label for a chip, without the article the sentence form needs. */
export function gapLabel(gap: string): string {
  const bare = gap.replace(/^(a|an|the) /, '')
  return bare.charAt(0).toUpperCase() + bare.slice(1)
}

/** "Needs a truck and a driver." - the gaps as one sentence. */
export function gapSentence(gaps: string[]): string | null {
  if (gaps.length === 0) return null
  const list = gaps.length === 1
    ? gaps[0]
    : `${gaps.slice(0, -1).join(', ')} and ${gaps[gaps.length - 1]}`
  return `Needs ${list}.`
}

/**
 * The action that ends a stage, and the status it moves the trip to.
 *
 * These are the same three transitions the board card has always offered - the
 * table lived in Logistics.tsx and was reachable only from a card, which put
 * the handoff in a different place from the evidence for it. Both call this.
 */
export const STAGE_ACTION: Partial<Record<TripStage, { next: DeliveryStatus; label: string }>> = {
  plan: { next: 'loading', label: 'Start loading' },
  dispatch: { next: 'in_transit', label: 'Dispatch' },
  delivery: { next: 'delivered', label: 'Confirm delivery' },
}

/** Which stage a transition completes - the one being left, not the one arrived at. */
export function stageCompletedBy(next: DeliveryStatus): TripStage | null {
  if (next === 'loading') return 'plan'
  if (next === 'in_transit') return 'dispatch'
  if (next === 'delivered' || next === 'failed') return 'delivery'
  return null
}

/** A stamp for right now, from whoever is signed in. */
export function stampNow(seat: Pick<Seat, 'id' | 'name'> | null | undefined, onBehalfOf?: ID): StageStamp {
  return {
    by: seat?.id,
    byName: seat?.name,
    at: new Date().toISOString(),
    ...(onBehalfOf ? { onBehalfOf } : {}),
  }
}

/**
 * The patch that moves a trip to `next`.
 *
 * Kept here rather than in either caller so the board card and the drawer
 * cannot drift apart on what a transition means. It does not touch the sale -
 * that belongs to whoever has the sales list to hand.
 */
export function advancePatch(
  d: Delivery,
  next: DeliveryStatus,
  seat: Pick<Seat, 'id' | 'name'> | null | undefined,
  extra?: Partial<Delivery>,
): Partial<Delivery> {
  const merged: Delivery = { ...d, ...extra }
  const stage = stageCompletedBy(next)
  const stamp = stampNow(seat, stage === 'dispatch' ? merged.driverId : undefined)
  return {
    ...extra,
    status: next,
    ...(stage ? { stamps: { ...(merged.stamps ?? {}), [stage]: stamp } } : {}),
    // Only a delivery completes the movement. A failed trip keeps whatever
    // completion time it had - usually none - so it stays out of the on-time
    // ratio rather than counting as an instant success.
    ...(next === 'delivered'
      ? { outcome: { ...(merged.outcome ?? {}), completedAt: merged.outcome?.completedAt || new Date().toISOString() } }
      : {}),
  }
}
