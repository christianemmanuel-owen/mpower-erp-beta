import { describe, expect, it } from 'vitest'
import { CHECKLIST_ITEMS } from './logistics'
import {
  advancePatch, documentSlots, gapSentence, receiptSlot, stageCompletedBy, stageGaps, stageOf, stageState,
} from './tripStages'
import type { Delivery, PreDispatchChecklist } from '../data/types'

const trip = (over: Partial<Delivery> = {}): Delivery => ({
  id: 'd1',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  saleId: 's1',
  scheduleDate: '2026-09-12T00:00:00.000Z',
  deliveryAddress: 'Valenzuela depot',
  contactPerson: 'R. Cruz',
  contactNumber: '0917 000 0000',
  status: 'scheduled',
  ...over,
})

const sig = { name: 'x', image: 'data:image/png;base64,', at: '2026-09-17T00:00:00.000Z' }
/** Every box ticked and every signature drawn. */
const ticked = (): PreDispatchChecklist => ({
  ...(Object.fromEntries(CHECKLIST_ITEMS.map((i) => [i.key, true])) as unknown as PreDispatchChecklist),
  signatures: { driver: sig, pahinante: sig, dispatcher: sig },
})

describe('trip stages', () => {
  it('reads the stage off the status the app already keeps', () => {
    expect(stageOf('scheduled')).toBe('plan')
    expect(stageOf('loading')).toBe('dispatch')
    expect(stageOf('in_transit')).toBe('delivery')
    expect(stageOf('delivered')).toBe('close')
    expect(stageOf('failed')).toBe('close')
  })

  /** A stage the trip has moved past is done even with blanks in it - the truck
   *  demonstrably left, and a "todo" mark on it would be a lie. */
  it('marks a passed stage done however empty it is', () => {
    expect(stageState('plan', 'in_transit')).toBe('done')
    expect(stageState('delivery', 'in_transit')).toBe('now')
    expect(stageState('close', 'in_transit')).toBe('later')
  })

  it('knows which document carries the signature, per movement', () => {
    expect(receiptSlot(trip())).toBe('deliveryReceipt')
    expect(receiptSlot(trip({ movementType: 'pickup_from_client' }))).toBe('signedReceipt')
    expect(receiptSlot(trip({ movementType: 'pickup_from_depot' }))).toBe('supplierReceipt')
  })

  it('files loading documents with dispatch and the receipt with delivery', () => {
    const docs = documentSlots(trip({ movementType: 'pickup_from_depot' }))
    expect(docs.delivery).toEqual(['supplierReceipt'])
    expect(docs.dispatch).toEqual(['depotLoadingSlip'])
    // The checklist is filled in, not filed, so it is in neither list.
    expect([...docs.dispatch, ...docs.delivery]).not.toContain('preDispatchChecklist')
  })

  it('names what each stage is still missing', () => {
    expect(stageGaps(trip(), 'plan', false)).toEqual(['a truck', 'a driver'])
    expect(stageGaps(trip({ truckId: 't1', driverId: 'p1' }), 'plan', false)).toEqual([])

    // The receipt number is a dispatch matter now - it goes out with the truck.
    const dr = { deliveryReceipt: { referenceNo: 'DR-1' } }
    expect(stageGaps(trip({ documents: dr, checklist: { ...ticked(), tiresInspected: false } }), 'dispatch', false))
      .toEqual(['1 checklist item'])
    expect(stageGaps(trip({ documents: dr, checklist: { ...ticked(), signatures: {} } }), 'dispatch', false))
      .toEqual(['the crew signatures'])
    expect(stageGaps(trip({ documents: dr, checklist: ticked() }), 'dispatch', false)).toEqual([])
    expect(stageGaps(trip({ checklist: ticked() }), 'dispatch', false)).toEqual(['a delivery receipt number'])
    // A pickup from a client dispatches no loaded vehicle, so it has no list.
    expect(stageGaps(trip({ movementType: 'pickup_from_client' }), 'dispatch', false)).toEqual([])

    // At the far end only the signing is left: who signed, and the signed copy.
    expect(stageGaps(trip({ documents: dr }), 'delivery', false)).toEqual(['who signed', 'the signed copy'])
    expect(stageGaps(trip({ documents: dr, receivedBy: 'J. Reyes' }), 'delivery', true)).toEqual([])
  })

  it('says the gaps as a sentence', () => {
    expect(gapSentence([])).toBeNull()
    expect(gapSentence(['a truck'])).toBe('Needs a truck.')
    expect(gapSentence(['a truck', 'a driver'])).toBe('Needs a truck and a driver.')
    expect(gapSentence(['a', 'b', 'c'])).toBe('Needs a, b and c.')
  })

  it('stamps the stage being left, not the one arrived at', () => {
    expect(stageCompletedBy('loading')).toBe('plan')
    expect(stageCompletedBy('in_transit')).toBe('dispatch')
    expect(stageCompletedBy('delivered')).toBe('delivery')
    expect(stageCompletedBy('failed')).toBe('delivery')
  })
})

describe('advancePatch', () => {
  const seat = { id: 'seat1', name: 'M. Reyes' }

  it('records who moved the trip on', () => {
    const patch = advancePatch(trip(), 'loading', seat)
    expect(patch.status).toBe('loading')
    expect(patch.stamps?.plan?.by).toBe('seat1')
    expect(patch.stamps?.plan?.byName).toBe('M. Reyes')
    expect(Date.parse(patch.stamps!.plan!.at)).not.toBeNaN()
  })

  /** Crew cannot sign in, so a dispatch names both the seat that typed it and
   *  the driver whose signature is on the paper. */
  it('names the driver a dispatch was recorded for', () => {
    const patch = advancePatch(trip({ status: 'loading', driverId: 'p9' }), 'in_transit', seat)
    expect(patch.stamps?.dispatch?.onBehalfOf).toBe('p9')
    expect(patch.stamps?.plan?.onBehalfOf).toBeUndefined()
  })

  it('keeps earlier stamps', () => {
    const first = advancePatch(trip(), 'loading', seat)
    const second = advancePatch({ ...trip(), ...first } as Delivery, 'in_transit', seat)
    expect(second.stamps?.plan).toBeTruthy()
    expect(second.stamps?.dispatch).toBeTruthy()
  })

  it('stamps a completion time on delivery and never on failure', () => {
    const done = advancePatch(trip({ status: 'in_transit' }), 'delivered', seat)
    expect(done.outcome?.completedAt).toBeTruthy()

    // A failed trip that counted as completed would enter the on-time ratio as
    // an instant success.
    const failed = advancePatch(trip({ status: 'in_transit' }), 'failed', seat)
    expect(failed.outcome).toBeUndefined()
  })

  it('does not overwrite a completion time someone set by hand', () => {
    const set = '2026-09-11T02:00:00.000Z'
    const patch = advancePatch(trip({ status: 'in_transit', outcome: { completedAt: set } }), 'delivered', seat)
    expect(patch.outcome?.completedAt).toBe(set)
  })

  it('carries the edits that were unsaved when the action was pressed', () => {
    const patch = advancePatch(trip({ status: 'in_transit' }), 'delivered', seat, { receivedBy: 'A. Dela Cruz' })
    expect(patch.receivedBy).toBe('A. Dela Cruz')
  })
})
