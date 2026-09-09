import { useEffect, useState } from 'react'
import {
  Field, FormSection, GhostButton, Input, PrimaryButton, Select, Textarea, Dialog,
} from '../../components/ui'
import { FormNav, useSectionNav, type FormNavSection } from '../../components/FormNav'
import StageBlock, { StageFacts } from './StageBlock'
import { RailAside, RailClose, RailRow, RailSection } from '../../components/SummaryRail'
import DocumentUpload from '../../components/DocumentUpload'
import ChecklistEditor from './ChecklistEditor'
import { slotLabel, useAttachments } from '../../lib/attachments'
import {
  STAGE_ACTION, TRIP_STAGES, documentSlots, gapSentence, receiptSlot, stageGaps, stageOf, stageState,
  stampNow,
} from '../../lib/tripStages'
import { useAuth } from '../../lib/auth'
import { isPending } from '../../lib/approvals'
import { fmtCurrency, fmtDate } from '../../lib/format'
import {
  CHECKLIST_ITEMS, MOVEMENT_LABELS, availableCrew, availableTrucks, bansFor,
  checklistProgress, movementType, needsChecklist, scheduleDrift,
  trucksInMaintenance,
} from '../../lib/logistics'
import { repos } from '../../data/repo'
import { CREW_ROLES } from '../../data/types'
import type { TruckBanRule, VehicleMaintenance } from '../../data/types'
import type { Delivery, DeliveryStatus, DocumentRef, MovementType, Personnel, Truck } from '../../data/types'

/**
 * One movement, in full - Exhibit A 1.5.
 *
 * This replaces a drawer that only assigned a truck and a driver. The spec asks
 * for considerably more, and the pieces are related: the movement type decides
 * which documents apply and whether a pre-dispatch checklist is required at all,
 * so those sections are driven off it rather than shown as a fixed list.
 *
 * The requested schedule and the final schedule are shown together on purpose.
 * Exhibit A distinguishes them - the customer asks for a slot, Logistics
 * reorganises into a final one - and a dispatcher moving a trip should be able
 * to see what was originally promised without leaving the drawer.
 */
interface TripDrawerProps {
  delivery: Delivery | null
  personnel: Personnel[]
  trucks: Truck[]
  deliveries: Delivery[]
  maintenance: VehicleMaintenance[]
  banRules: TruckBanRule[]
  onClose: () => void
  onNotice: (message: string) => void
  /**
   * Move the trip on a stage, carrying whatever is unsaved in the form.
   *
   * Owned by the board because completing a delivery also fulfils its sale, and
   * the sales list lives there. Both callers go through advancePatch, so a
   * transition means the same thing whichever end it is started from.
   */
  onAdvance: (next: DeliveryStatus, patch: Partial<Delivery>) => Promise<void>
}

/**
 * The null check, and nothing else.
 *
 * Split from the body because the body holds hooks that must run in the same
 * order every render, and `delivery` is null whenever the drawer is closed. A
 * `return null` above a hook means the hook count changes the moment a trip is
 * opened - React's "rendered more hooks than during the previous render". The
 * key remounts the body per trip, which is also what resets the edit buffer.
 */
export default function TripDrawer(props: TripDrawerProps) {
  if (!props.delivery) return null
  return <TripDrawerBody key={props.delivery.id} {...props} delivery={props.delivery} />
}

function TripDrawerBody({ delivery, personnel, trucks, deliveries, maintenance, banRules, onClose, onNotice, onAdvance }:
  TripDrawerProps & { delivery: Delivery }) {
  const [form, setForm] = useState<Partial<Delivery>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [advancing, setAdvancing] = useState(false)
  const { seat } = useAuth()

  useEffect(() => {
    setForm({})
    setError(null)
  }, [delivery])

  // The working record: saved values with unsaved edits laid over the top, so
  // document and checklist sections react to a movement-type change immediately.
  const draft: Delivery = { ...delivery, ...form }
  const set = (k: keyof Delivery, v: unknown) => setForm((f) => ({ ...f, [k]: v }))

  // Availability on the day this trip is actually scheduled for, so moving the
  // schedule re-answers the question rather than leaving a stale one on screen.
  const day = draft.scheduleDate.slice(0, 10)
  const busyTruckIds = new Set(
    availableTrucks(trucks, deliveries.filter((d) => d.id !== draft.id), day).busy.map((b) => b.item.id),
  )
  const workshopTruckIds = trucksInMaintenance(maintenance, day)

  // The crew half of the same question. availableTrucks was wired into the
  // picker below and availableCrew was not, so a driver could be booked onto
  // two movements on the same day with nothing saying so - while the truck
  // beside them was checked.
  const busyCrewIds = new Set(
    (['driver', 'pahinante', 'loader', 'guard', 'manager'] as const).flatMap((role) =>
      availableCrew(personnel, deliveries.filter((d) => d.id !== draft.id), day, role)
        .busy.map((b) => b.item.id),
    ),
  )

  const chosenTruck = trucks.find((t) => t.id === draft.truckId)
  const bans = chosenTruck ? bansFor(banRules, chosenTruck.plateNumber, draft.scheduleDate) : []
  const truckNote = workshopTruckIds.has(draft.truckId ?? '')
    ? 'This truck is booked into maintenance on the scheduled day.'
    : busyTruckIds.has(draft.truckId ?? '')
      ? 'This truck is already on another movement that day.'
      : null

  const setDocRef = (slot: string, referenceNo: string) =>
    setForm((f) => ({
      ...f,
      documents: {
        ...(draft.documents ?? {}),
        [slot]: { ...(draft.documents?.[slot] ?? {}), referenceNo } as DocumentRef,
      },
    }))

  const setOutcome = (k: 'delayReason' | 'failureReason' | 'notes', v: string) =>
    setForm((f) => ({ ...f, outcome: { ...(draft.outcome ?? {}), [k]: v } }))

  /**
   * The completion time, editable rather than read-only.
   *
   * It is stamped automatically when someone marks a trip delivered on the
   * board, which means a trip that reached 'delivered' any other way - imported
   * history, a status changed here, a record seeded before the app existed -
   * carries no stamp at all. `deliveryPerformance` excludes those from the
   * on-time ratio rather than guessing, so a history with no stamps produces no
   * percentage: correct, and useless. This is the way to fill one in.
   *
   * Empty string rather than undefined on clear: update is a merge server-side
   * and JSON.stringify drops undefined keys, so undefined would leave the old
   * stamp standing.
   */
  const setCompletedAt = (day: string) =>
    setForm((f) => ({
      ...f,
      outcome: { ...(draft.outcome ?? {}), completedAt: day ? new Date(`${day}T00:00:00`).toISOString() : '' },
    }))

  const byRole = (role: Personnel['role']) => personnel.filter((p) => p.role === role && p.active !== false)
  const progress = checklistProgress(draft.checklist)
  const drift = scheduleDrift(draft)

  async function save() {
    if (!delivery) return
    setSaving(true)
    setError(null)
    try {
      // The other three stages are stamped by their own action. Close has no
      // action - a trip is closed by writing down what happened - so recording
      // an outcome on a finished trip is the handoff, and this is where it is
      // stamped. Re-stamped on each edit: it means "outcome last recorded by",
      // which is the useful reading when a reason is corrected a week later.
      const closing = !!form.outcome && (delivery.status === 'delivered' || delivery.status === 'failed')
      const patch = closing
        ? { ...form, stamps: { ...(draft.stamps ?? {}), close: stampNow(seat) } }
        : form
      const result = await repos.deliveries.update(delivery.id, patch)
      if (isPending(result)) onNotice(result.message)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t save this trip.')
    } finally {
      setSaving(false)
    }
  }

  /**
   * Which stage the trip is on, and what each one still wants.
   *
   * Read from the SAVED status rather than the draft: the form does not edit
   * status - the stage actions do - so a half-typed form never moves the trip.
   */
  const stage = stageOf(delivery.status)
  const { data: files } = useAttachments('deliveries', delivery.id)
  const receipt = receiptSlot(draft)
  const receiptOnFile = (files ?? []).some((f) => f.slot === receipt)
  const docs = documentSlots(draft)
  const gaps = (key: Parameters<typeof stageGaps>[1]) => gapSentence(stageGaps(draft, key, receiptOnFile))

  /**
   * Save whatever is typed, then move the trip on.
   *
   * One call rather than "save, then press the button on the card": the
   * evidence and the handoff were in different places, so a dispatcher could
   * mark a trip delivered from the board with the receipt still untyped in a
   * drawer they had open.
   */
  async function advance(next: DeliveryStatus) {
    setAdvancing(true)
    setError(null)
    try {
      await onAdvance(next, form)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn\u2019t move this trip on.')
    } finally {
      setAdvancing(false)
    }
  }

  // The nav is the stage list now: four entries in handoff order, marked by
  // where the trip actually is rather than by which fields happen to be filled.
  const navSections: FormNavSection[] = TRIP_STAGES.map((s) => ({
    id: `stage-${s.key}`,
    title: s.title,
    state: stageState(s.key, delivery.status) === 'done' ? 'done' : 'todo',
  }))
  const { active, jump } = useSectionNav(TRIP_STAGES.map((s) => `stage-${s.key}`))

  const crewField = (label: string, key: 'driverId' | 'pahinanteId' | 'loaderId' | 'guardId' | 'managerId', role: Personnel['role']) => (
    <Field label={label}>
      <Select value={(draft[key] as string) ?? ''} onChange={(e) => set(key, e.target.value || undefined)}>
        <option value="">—</option>
        {byRole(role).map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}{busyCrewIds.has(p.id) ? ' — already booked' : ''}
          </option>
        ))}
      </Select>
    </Field>
  )

  return (
    <Dialog
      open
      // "Trip" named the type of thing rather than which one. The movement type
      // says what this is, the plate and address say which.
      title={MOVEMENT_LABELS[movementType(draft)]}
      subtitle={[chosenTruck?.plateNumber, draft.deliveryAddress].filter(Boolean).join(' · ') || undefined}
      aside={
        <span className="text-right">
          <span className="block font-meta text-[12px] text-mut">Scheduled</span>
          <span className="block text-[13px] font-semibold leading-[1.2]">
            {fmtDate(draft.scheduleDate)}{draft.scheduleTime ? ` · ${draft.scheduleTime}` : ''}
          </span>
        </span>
      }
      onClose={onClose}
      width={1100}
      nav={<FormNav sections={navSections} active={active} onJump={jump} />}
      rail={
        <>
          <RailSection title="Schedule">
            {draft.requestedDate && (
              <RailRow
                label="Customer asked for"
                value={`${fmtDate(draft.requestedDate)}${draft.requestedTime ? ` · ${draft.requestedTime}` : ''}`}
              />
            )}
            <RailRow label="Final schedule" value={fmtDate(draft.scheduleDate)} />
            {drift !== null && drift !== 0 && (
              <RailClose
                label={drift > 0 ? 'Moved later by' : 'Moved earlier by'}
                tone={drift > 0 ? 'bad' : 'plain'}
                value={`${Math.abs(drift)} day${Math.abs(drift) === 1 ? '' : 's'}`}
              />
            )}
          </RailSection>

          <RailSection title="Pre-dispatch">
            {/* Out of the footer, where a progress count sat beside Cancel and
                Save as though it were an action. */}
            {needsChecklist(draft) ? (
              <>
                <RailRow label="Answered" value={`${progress.answered} of ${progress.total}`} />
                {progress.complete
                  ? <RailAside>Complete.</RailAside>
                  : <RailAside tone="bad">{progress.outstanding.length} item{progress.outstanding.length === 1 ? '' : 's'} outstanding.</RailAside>}
              </>
            ) : (
              <RailAside>Not required for this movement.</RailAside>
            )}
          </RailSection>

          {(truckNote || bans.length > 0) && (
            <RailSection title={chosenTruck?.plateNumber ?? 'Vehicle'}>
              {/* A ban rule nobody checks against a trip is a document, not a
                  control. It was a banner mid-form; here it sits with the rest
                  of what is true about this trip. */}
              {bans.length > 0 && (
                <RailAside tone="bad">
                  Banned at this time by {bans.map((b) => `${b.authority} (${b.area}, ${b.startTime}–${b.endTime})`).join(' and ')}.
                </RailAside>
              )}
              {truckNote && <RailAside tone="bad">{truckNote}</RailAside>}
            </RailSection>
          )}
        </>
      }
      footer={
        <>
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save trip'}</PrimaryButton>
        </>
      }
    >
      {error && (
        <p className="mb-3 rounded-[6px] border border-redf bg-redbadge px-3 py-2 text-[13px] font-semibold text-redtext">{error}</p>
      )}

      {/* ---- 1. Plan -------------------------------------------------------
          Booked by office staff off the sale: what is moving, when, where to,
          and who takes it. */}
      <StageBlock
        id="stage-plan"
        title="Plan"
        owner="Logistics"
        state={stageState('plan', delivery.status)}
        stamp={draft.stamps?.plan}
        stampLabel="Booked by"
        summary={
          <StageFacts
            items={[
              { label: 'Scheduled', value: `${fmtDate(draft.scheduleDate)}${draft.scheduleTime ? ` · ${draft.scheduleTime}` : ''}` },
              { label: 'Truck', value: chosenTruck?.plateNumber ?? '—' },
              { label: 'Destination', value: draft.deliveryAddress || '—' },
              { label: 'Driver', value: personnel.find((p) => p.id === draft.driverId)?.name ?? '—' },
            ]}
          />
        }
        action={
          stage === 'plan' ? (
            <>
              <PrimaryButton onClick={() => advance(STAGE_ACTION.plan!.next)} disabled={advancing}>
                {STAGE_ACTION.plan!.label}
              </PrimaryButton>
              {/* Warns, never blocks: a truck can be at the gate before the
                  form is finished, and a hard stop only teaches people to type
                  something to get past it. */}
              {gaps('plan') && <p className="m-0 font-meta text-[12px] font-semibold text-redtext">{gaps('plan')}</p>}
            </>
          ) : undefined
        }
      >
        <FormSection first>Movement</FormSection>
        <div className="grid grid-cols-2 gap-x-4 gap-y-[14px]">
          <Field
            label="Type of movement"
            span2
            hint="Determines which documents apply and whether a pre-dispatch checklist is required."
          >
            <Select
              value={movementType(draft)}
              onChange={(e) => set('movementType', e.target.value as MovementType)}
            >
              {(Object.keys(MOVEMENT_LABELS) as MovementType[]).map((m) => (
                <option key={m} value={m}>{MOVEMENT_LABELS[m]}</option>
              ))}
            </Select>
          </Field>
        </div>

        {/* Exhibit A 1.5 - the customer's request and the reorganised final
            schedule are different things, and both matter. The request and the
            drift between them live in the rail, where they stay visible while
            this section is edited. */}
        <FormSection>Schedule</FormSection>
        <div className="grid grid-cols-2 gap-x-4 gap-y-[14px]">
          <Field label="Scheduled date">
            <Input
              type="date"
              value={(draft.scheduleDate ?? '').slice(0, 10)}
              onChange={(e) => set('scheduleDate', new Date(e.target.value).toISOString())}
            />
          </Field>
          <Field label="Scheduled time">
            <Input type="time" value={draft.scheduleTime ?? ''} onChange={(e) => set('scheduleTime', e.target.value)} />
          </Field>
          <Field label="ETA" span2 hint="Entered by Logistics. A computed ETA requires GPS tracking.">
            <Input
              type="datetime-local"
              value={draft.etaAt ? draft.etaAt.slice(0, 16) : ''}
              onChange={(e) => set('etaAt', e.target.value ? new Date(e.target.value).toISOString() : undefined)}
            />
          </Field>
        </div>

        <FormSection>Destination &amp; contact</FormSection>
        <div className="grid grid-cols-2 gap-x-4 gap-y-[14px]">
          <Field label="Address" span2>
            <Input value={draft.deliveryAddress ?? ''} onChange={(e) => set('deliveryAddress', e.target.value)} />
          </Field>
          <Field label="Contact person">
            <Input value={draft.contactPerson ?? ''} onChange={(e) => set('contactPerson', e.target.value)} />
          </Field>
          <Field label="Contact number">
            <Input value={draft.contactNumber ?? ''} onChange={(e) => set('contactNumber', e.target.value)} />
          </Field>
        </div>

        <FormSection>Crew &amp; vehicle</FormSection>
        <div className="grid grid-cols-2 gap-x-4 gap-y-[14px]">
          <Field label="Truck" hint={truckNote ?? undefined}>
            <Select value={draft.truckId ?? ''} onChange={(e) => set('truckId', e.target.value || undefined)}>
              <option value="">—</option>
              {trucks.map((t) => {
                // Availability was computed, tested, and never rendered: a
                // dispatcher could book a truck already out on another movement,
                // or one sitting in the workshop, and nothing said so.
                const busy = busyTruckIds.has(t.id)
                const workshop = workshopTruckIds.has(t.id)
                const why = workshop ? 'in maintenance' : busy ? 'already booked' : null
                return (
                  <option key={t.id} value={t.id}>
                    {t.plateNumber}{why ? ` — ${why}` : ''}
                  </option>
                )
              })}
            </Select>
          </Field>
          {crewField('Driver', 'driverId', 'driver')}
          {crewField('Pahinante', 'pahinanteId', 'pahinante')}
          {crewField('Loading personnel', 'loaderId', 'loader')}
          {crewField('Guard on duty', 'guardId', 'guard')}
          {crewField('Manager', 'managerId', 'manager')}
        </div>
      </StageBlock>

      {/* ---- 2. Dispatch ---------------------------------------------------
          The crew's stage. They check the vehicle and sign the printed slip;
          an office seat records what came back, which is why the stamp names
          both (StageStamp.onBehalfOf). */}
      <StageBlock
        id="stage-dispatch"
        title="Dispatch"
        owner="Crew, on paper"
        state={stageState('dispatch', delivery.status)}
        stamp={draft.stamps?.dispatch}
        stampLabel="Dispatched by"
        summary={
          <StageFacts
            items={[
              {
                label: 'Checklist',
                value: needsChecklist(draft)
                  ? `${progress.answered} of ${progress.total}${draft.checklist?.referenceNo ? ` · ${draft.checklist.referenceNo}` : ''}`
                  : 'Not required',
              },
              {
                label: 'Allowance',
                value: draft.checklist?.allowanceIssued ? fmtCurrency(draft.checklist.allowanceIssued) : '—',
              },
            ]}
          />
        }
        action={
          stage === 'dispatch' ? (
            <>
              <PrimaryButton onClick={() => advance(STAGE_ACTION.dispatch!.next)} disabled={advancing}>
                {STAGE_ACTION.dispatch!.label}
              </PrimaryButton>
              {gaps('dispatch') && <p className="m-0 font-meta text-[12px] font-semibold text-redtext">{gaps('dispatch')}</p>}
            </>
          ) : undefined
        }
      >
        {needsChecklist(draft) ? (
          <ChecklistEditor
            draft={draft}
            personnel={personnel}
            trucks={trucks}
            onChange={(checklist) => set('checklist', checklist)}
            onNotice={onNotice}
          />
        ) : (
          <p className="m-0 font-meta text-[12px] text-mut">
            A {MOVEMENT_LABELS[movementType(draft)].toLowerCase()} carries no pre-dispatch checklist - MPower is not
            sending out a loaded vehicle.
          </p>
        )}

        {docs.dispatch.length > 0 && (
          <>
            <FormSection>Loading documents</FormSection>
            <div className="grid gap-3">
              {docs.dispatch.map((slot) => (
                <Field key={slot} label={`${slotLabel(slot)} - reference number`}>
                  <Input
                    value={draft.documents?.[slot]?.referenceNo ?? ''}
                    placeholder="e.g. DS-2026-00187"
                    onChange={(e) => setDocRef(slot, e.target.value)}
                  />
                </Field>
              ))}
            </div>
            <div className="mt-3">
              <DocumentUpload tbl="deliveries" recordId={delivery.id} slots={docs.dispatch} />
            </div>
          </>
        )}
      </StageBlock>

      {/* ---- 3. Delivery ---------------------------------------------------
          The far end. Whoever takes the signed copy records it - the driver on
          return, or the office if it arrives as a photo - which is why this
          stage names no single role. Before this existed the receipt was one
          reference field in a list of documents, and nothing recorded that a
          customer had actually signed for the load. */}
      <StageBlock
        id="stage-delivery"
        title="Delivery"
        owner="Driver or office"
        state={stageState('delivery', delivery.status)}
        stamp={draft.stamps?.delivery}
        stampLabel="Confirmed by"
        summary={
          <StageFacts
            items={[
              { label: slotLabel(receipt), value: draft.documents?.[receipt]?.referenceNo || '—' },
              { label: 'Signed by', value: draft.receivedBy || '—' },
            ]}
          />
        }
        action={
          stage === 'delivery' ? (
            <>
              <PrimaryButton onClick={() => advance('delivered')} disabled={advancing}>Confirm delivery</PrimaryButton>
              {/* 'failed' is a status the board could display and nothing could
                  reach: a trip that came back undelivered had to be marked
                  delivered or left in transit for ever. */}
              <GhostButton onClick={() => advance('failed')} disabled={advancing}>Mark failed</GhostButton>
              {gaps('delivery') && <p className="m-0 font-meta text-[12px] font-semibold text-redtext">{gaps('delivery')}</p>}
            </>
          ) : undefined
        }
      >
        <div className="grid grid-cols-2 gap-x-4 gap-y-[14px]">
          <Field label={`${slotLabel(receipt)} no.`}>
            <Input
              value={draft.documents?.[receipt]?.referenceNo ?? ''}
              placeholder="e.g. DR-2026-00187"
              onChange={(e) => setDocRef(receipt, e.target.value)}
            />
          </Field>
          <Field label="Received on" hint="The date on the signed copy, which is not always the day it reached the office.">
            <Input
              type="date"
              value={(draft.receivedOn ?? '').slice(0, 10)}
              onChange={(e) => set('receivedOn', e.target.value)}
            />
          </Field>
          <Field label="Received by" span2 hint="The person at the far end who signed for the load, not the crew.">
            <Input
              value={draft.receivedBy ?? ''}
              placeholder="Name on the receipt"
              onChange={(e) => set('receivedBy', e.target.value)}
            />
          </Field>
        </div>
        <div className="mt-3">
          <DocumentUpload tbl="deliveries" recordId={delivery.id} slots={[receipt]} />
        </div>
      </StageBlock>

      {/* ---- 4. Close ------------------------------------------------------
          What the on-time and completion figures are made of. */}
      <StageBlock
        id="stage-close"
        title="Close"
        owner="Office"
        state={stageState('close', delivery.status)}
        stamp={draft.stamps?.close}
        stampLabel="Outcome recorded by"
        summary={
          <StageFacts
            items={[
              { label: 'Completed on', value: draft.outcome?.completedAt ? fmtDate(draft.outcome.completedAt) : '—' },
              { label: 'Reason', value: draft.outcome?.failureReason || draft.outcome?.delayReason || '—' },
            ]}
          />
        }
        action={
          delivery.status === 'failed' ? (
            <>
              <GhostButton onClick={() => advance('in_transit')} disabled={advancing}>Reopen trip</GhostButton>
              <p className="m-0 font-meta text-[12px] text-mut">Puts it back in transit for another attempt.</p>
            </>
          ) : undefined
        }
      >
        <p className="m-0 mb-[12px] font-meta text-[12px] text-mut">
          Reasons recorded here feed the on-time and completion figures.
        </p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-[14px]">
          <Field label="Reason for delay" span2>
            <Input
              value={draft.outcome?.delayReason ?? ''}
              placeholder="e.g. Truck ban on C-5 until 9am"
              onChange={(e) => setOutcome('delayReason', e.target.value)}
            />
          </Field>
          <Field
            label="Reason not completed"
            span2
            error={delivery.status === 'failed' && !draft.outcome?.failureReason
              ? 'This trip failed - say why, or the completion figures cannot explain it.'
              : undefined}
          >
            <Input
              value={draft.outcome?.failureReason ?? ''}
              placeholder="e.g. Site closed on arrival"
              onChange={(e) => setOutcome('failureReason', e.target.value)}
            />
          </Field>
          <Field label="Notes" span2>
            <Textarea value={draft.outcome?.notes ?? ''} onChange={(e) => setOutcome('notes', e.target.value)} />
          </Field>
          <Field
            label="Completed on"
            hint="Stamped when the delivery is confirmed. Set it here for a trip that reached delivered another way."
          >
            <Input
              type="date"
              value={draft.outcome?.completedAt ? draft.outcome.completedAt.slice(0, 10) : ''}
              onChange={(e) => setCompletedAt(e.target.value)}
            />
          </Field>
        </div>
      </StageBlock>
    </Dialog>
  )
}

export { CREW_ROLES, CHECKLIST_ITEMS }
