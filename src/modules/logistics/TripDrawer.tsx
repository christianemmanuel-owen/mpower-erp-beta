import { useEffect, useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import {
  Field, FormSection, GhostButton, Input, PrimaryButton, RowAction, Select, Textarea, Dialog,
} from '../../components/ui'
import { FormNav, useSectionNav, type FormNavSection } from '../../components/FormNav'
import StageBlock, { StageFacts } from './StageBlock'
import { RailAside, RailClose, RailRow, RailSection } from '../../components/SummaryRail'
import DocumentUpload from '../../components/DocumentUpload'
import ChecklistEditor from './ChecklistEditor'
import TruckDayStrip from './TruckDayStrip'
import { allocateReference, slotLabel, useAttachments } from '../../lib/attachments'
import {
  STAGE_ACTION, TRIP_STAGES, documentSlots, gapSentence, receiptSlot, stageGaps, stageOf, stageState,
  stampNow,
} from '../../lib/tripStages'
import { useAuth } from '../../lib/auth'
import { isPending } from '../../lib/approvals'
import { fmtCurrency, fmtDate, fmtDateTime } from '../../lib/format'
import RoutePlanner from './RoutePlanner'
import {
  CHECKLIST_ITEMS, MOVEMENT_LABELS, TRIP_MOVEMENTS, availableCrew, availableTrucks, bansFor,
  checklistProgress, movementType, needsChecklist, scheduleDrift,
  trucksInMaintenance, fmtHour, fmtHours, tripHours, truckBookings, tripStartHour, tripDeparture, dayBans, clearDeparture,
} from '../../lib/logistics'
import { repos } from '../../data/repo'
import { CREW_ROLES } from '../../data/types'
import type { TruckBanRule, VehicleMaintenance } from '../../data/types'
import { isHeavyTruck, type NumberCodingSettings } from '../../lib/numberCoding'
import { loadCheck, tollProblems } from '../../lib/vehicleLimits'
import { ZONE_LABELS, type ZoneKey } from '../../lib/zones'
import type { Delivery, DeliveryStatus, DocumentRef, GeoPoint, MovementType, Personnel, Truck } from '../../data/types'

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
  /** A seat that may look but not change it - a sales or treasury seat
   *  opening the trip from a sale or the calendar. Every control is disabled
   *  and the footer only closes; the server refuses the edit anyway. */
  readOnly?: boolean
  delivery: Delivery | null
  personnel: Personnel[]
  trucks: Truck[]
  deliveries: Delivery[]
  maintenance: VehicleMaintenance[]
  banRules: TruckBanRule[]
  /** Holiday dates, yyyy-MM-dd, on which number coding stands down. */
  holidays?: readonly string[]
  /** The litres this trip carries - the sale's volume - for the weight check. */
  liters?: number
  /** Which vehicle checks are switched on (Regulations). */
  checks?: Pick<NumberCodingSettings, 'overloadCheck' | 'tollClassCheck' | 'fuelTankersExempt'>
  /** Where the truck leaves from for this trip - the sale's depot - for the
   * drive-time estimate. Coordinates when the depot has them, else its
   * address. Blank when the trip has no depot to speak of. */
  origin?: { label: string; query: string; point?: GeoPoint }
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

function TripDrawerBody({ delivery, personnel, trucks, deliveries, maintenance, banRules, holidays, liters, checks, origin, onClose, onNotice, onAdvance, readOnly = false }:
  TripDrawerProps & { delivery: Delivery }) {
  const [form, setForm] = useState<Partial<Delivery>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [advancing, setAdvancing] = useState(false)
  const [allocatingDr, setAllocatingDr] = useState(false)
  const [planning, setPlanning] = useState(false)
  // The times are shown, not asked for: the departure comes from clicking
  // the truck's day, the ETA from the route. Edit is the fallback.
  const [editingTimes, setEditingTimes] = useState(false)
  const { seat } = useAuth()

  useEffect(() => {
    setForm({})
    setError(null)
  }, [delivery])

  // The working record: saved values with unsaved edits laid over the top, so
  // document and checklist sections react to a movement-type change immediately.
  const draft: Delivery = { ...delivery, ...form }
  const set = (k: keyof Delivery, v: unknown) => setForm((f) => ({ ...f, [k]: v }))

  // The ETA follows the departure time and the planned drive. Written into
  // the form whenever either changes, so it is saved with the trip and still
  // sits in an editable field for the dispatcher who knows better.
  const etaFromRoute = draft.scheduleTime && draft.travelEstimate
    ? tripStartHour(draft) + draft.travelEstimate.minutesOneWay / 60
    : null
  useEffect(() => {
    if (etaFromRoute === null || !draft.scheduleDate) return
    const at = new Date(draft.scheduleDate.slice(0, 10) + 'T00:00:00')
    at.setMinutes(Math.round(etaFromRoute * 60))
    const iso = at.toISOString()
    if (draft.etaAt !== iso) set('etaAt', iso)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [etaFromRoute, draft.scheduleDate])


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
  // Checked for the whole time the truck is out - it leaves at the departure
  // and is on the road for the trip's hours - not just the moment it leaves:
  // a 05:30 departure on an eight-hour run is on EDSA all through the
  // morning window.
  const leaveISO = tripDeparture(draft).toISOString()
  const hours = tripHours(draft)
  const banCtx = { holidays, zones: draft.travelEstimate?.zones, hours }
  const bans = chosenTruck
    ? bansFor(banRules, chosenTruck.plateNumber, leaveISO, { heavy: isHeavyTruck(chosenTruck), ...banCtx })
    : []
  // Every window that catches this truck that day, for the day strip.
  const banWindows = chosenTruck
    ? dayBans(banRules, chosenTruck.plateNumber, leaveISO, { heavy: isHeavyTruck(chosenTruck), ...banCtx })
    : []
  // Two ways out of a ban, offered rather than left to the dispatcher to work
  // out: the first later departure that fits the whole run between the
  // windows, or a truck the rules do not catch. Only trucks free that day
  // count as a way out.
  const clearAt = chosenTruck && bans.length > 0
    ? clearDeparture(banRules, chosenTruck.plateNumber, leaveISO, hours, { heavy: isHeavyTruck(chosenTruck), holidays, zones: draft.travelEstimate?.zones })
    : null
  const clearTrucks = bans.length > 0
    ? trucks.filter((t) => t.id !== chosenTruck?.id && !busyTruckIds.has(t.id) && !workshopTruckIds.has(t.id)
        && bansFor(banRules, t.plateNumber, leaveISO, { heavy: isHeavyTruck(t), ...banCtx }).length === 0)
    : []
  // The city rules wait for a route; say so, rather than staying silent as
  // if the trip were clear.
  const cityRulesWaiting = !draft.travelEstimate && banRules.some((r) => r.zone && r.active !== false)
  // The truck itself: too heavy for the road, or the wrong class for the ramp.
  const load = chosenTruck && checks?.overloadCheck !== false ? loadCheck(chosenTruck, liters) : null
  const tolls = chosenTruck && checks?.tollClassCheck !== false ? tollProblems(chosenTruck, draft.travelEstimate?.zones) : []
  const routeZones = (draft.travelEstimate?.zones ?? []).map((z) => ZONE_LABELS[z as ZoneKey] ?? z)
  const truckNote = workshopTruckIds.has(draft.truckId ?? '')
    ? 'This truck is booked into maintenance on the scheduled day.'
    : busyTruckIds.has(draft.truckId ?? '')
      ? `Already booked ${truckBookings(deliveries, draft.truckId ?? '', day, draft.id).map((b) => fmtHour(b.start)).join(' and ')} that day - the strip below shows where a second run fits.`
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
            {p.name}{busyCrewIds.has(p.id) ? ' — on another trip that day' : ''}
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

          {(truckNote || bans.length > 0 || cityRulesWaiting || (load && load.overKg > 0) || tolls.length > 0) && (
            <RailSection title={chosenTruck?.plateNumber ?? 'Vehicle'}>
              {/* A ban rule nobody checks against a trip is a document, not a
                  control. It was a banner mid-form; here it sits with the rest
                  of what is true about this trip. */}
              {/* Say which law it is. Number coding follows the plate's last
                  digit and lifts on holidays; the truck ban is a time window
                  for heavy trucks whatever the plate. The client read the
                  old one-line warning as plate-based either way. */}
              {bans.map((b) => (
                <RailAside key={b.id} tone="bad">
                  {b.plateEndsWith.length > 0
                    ? `Number coding: plate ends in ${b.plateEndsWith.join(' or ')}, ${b.authority} ${b.startTime}–${b.endTime}.`
                    : `Truck ban: ${b.authority}, ${b.startTime}–${b.endTime}${b.appliesTo === 'heavy' ? ' for heavy trucks' : b.appliesTo === 'light' ? ' for light trucks' : ''}.`}
                </RailAside>
              ))}
              {load && load.overKg > 0 && (
                <RailAside tone="bad">
                  Overloaded: about {load.ladenKg.toLocaleString()} kg laden against {load.maxKg.toLocaleString()} kg allowed (RA 8794) - {load.overKg.toLocaleString()} kg over.
                </RailAside>
              )}
              {tolls.map((t) => (
                <RailAside key={t.zone} tone="bad">
                  The planned route uses the Skyway: {t.label.toLowerCase()}. Pick a route on the at-grade road.
                </RailAside>
              ))}
              {cityRulesWaiting && <RailAside>Plan the route to check the city truck bans against it.</RailAside>}
              {truckNote && <RailAside tone="bad">{truckNote}</RailAside>}
            </RailSection>
          )}
          {routeZones.length > 0 && (
            <RailSection title="Route passes through">
              <RailAside>{routeZones.join(' · ')}</RailAside>
            </RailSection>
          )}
        </>
      }
      footer={readOnly ? (
        <PrimaryButton onClick={onClose}>Close</PrimaryButton>
      ) : (
        <>
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save trip'}</PrimaryButton>
        </>
      )}
    >
      <fieldset disabled={readOnly} className="contents [&:disabled_*]:cursor-default">
      {readOnly && (
        <p className="mb-3 rounded-[6px] border border-line bg-paper px-3 py-2 font-meta text-[12px] text-mut">
          Viewing only. Planning and moving the trip is Trips’ work.
        </p>
      )}
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
        // A plan with a ban or a gap in it opens on arrival, however far the
        // trip has moved on: a trip booked by a drop on the board lands
        // here with its truck and hour and nothing else checked.
        defaultOpen={stageState('plan', delivery.status) === 'now' || bans.length > 0 || stageGaps(draft, 'plan', receiptOnFile).length > 0}
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
            hint="What the company truck is doing. Supplier or hauler deliveries are recorded on the purchase, not here."
          >
            <Select
              value={movementType(draft)}
              onChange={(e) => set('movementType', e.target.value as MovementType)}
            >
              {/* Only what a company truck does. A record of the old fourth
                  type keeps its label as a disabled option so it still reads. */}
              {TRIP_MOVEMENTS.map((m) => (
                <option key={m} value={m}>{MOVEMENT_LABELS[m]}</option>
              ))}
              {!TRIP_MOVEMENTS.includes(movementType(draft)) && (
                <option value={movementType(draft)}>{MOVEMENT_LABELS[movementType(draft)]} (supplier or hauler - now recorded on the purchase)</option>
              )}
            </Select>
          </Field>
        </div>

        {/* Where it is going comes before when: the route from the depot is
            what tells the dispatcher how long the truck is tied up and when
            it arrives, so the address and its route are settled first. */}
        <FormSection>Destination</FormSection>
        <div className="grid grid-cols-2 gap-x-4 gap-y-[14px]">
          <Field
            label="Address"
            span2
            hint={draft.travelEstimate
              ? `${fmtHours(draft.travelEstimate.minutesOneWay / 60)} drive each way${draft.travelEstimate.summary ? ` ${draft.travelEstimate.summary}` : ''} · ${draft.travelEstimate.km} km · ${draft.travelEstimate.unloadMinutes ?? 30} min to unload · truck tied up ${fmtHours(tripHours(draft))}. ${draft.travelEstimate.provider === 'google' ? 'Google Maps' : 'OpenStreetMap'}, ${fmtDateTime(draft.travelEstimate.at)}.`
              : origin ? `Plan the route from ${origin.label} to get the drive time, the ETA and how long the truck is tied up.` : undefined}
          >
            <div className="flex items-center gap-[6px]">
              <Input value={draft.deliveryAddress ?? ''} placeholder="Street, barangay, city" onChange={(e) => set('deliveryAddress', e.target.value)} />
              {origin && (
                <GhostButton
                  className="shrink-0 whitespace-nowrap"
                  onClick={() => setPlanning(true)}
                  disabled={!draft.deliveryAddress?.trim() && !draft.destination}
                  title={`Routes from ${origin.label} to this address, on a map`}
                >
                  {draft.travelEstimate ? 'Re-plan route' : 'Plan route'}
                </GhostButton>
              )}
            </div>
          </Field>
          <Field label="Contact person">
            <Input value={draft.contactPerson ?? ''} onChange={(e) => set('contactPerson', e.target.value)} />
          </Field>
          <Field label="Contact number">
            <Input value={draft.contactNumber ?? ''} onChange={(e) => set('contactNumber', e.target.value)} />
          </Field>
        </div>

        {/* Exhibit A 1.5 - the customer's request and the reorganised final
            schedule are different things, and both matter. The request and the
            drift between them live in the rail, where they stay visible while
            this section is edited. One time is asked for - when the truck
            leaves - and everything else on the clock follows from it and the
            route: the ETA, and how long the truck is tied up. */}
        <FormSection>Schedule &amp; truck</FormSection>
        <div className="grid grid-cols-2 gap-x-4 gap-y-[14px]">
          <Field label="Date">
            <Input
              type="date"
              value={(draft.scheduleDate ?? '').slice(0, 10)}
              onChange={(e) => set('scheduleDate', new Date(e.target.value).toISOString())}
            />
          </Field>
          <Field label="Truck" span2 hint={truckNote ?? undefined}>
            <Select value={draft.truckId ?? ''} onChange={(e) => set('truckId', e.target.value || undefined)}>
              <option value="">—</option>
              {trucks.map((t) => {
                // Availability was computed, tested, and never rendered: a
                // dispatcher could book a truck already out on another movement,
                // or one sitting in the workshop, and nothing said so.
                const busy = busyTruckIds.has(t.id)
                const workshop = workshopTruckIds.has(t.id)
                // Not "booked that day" but when: the times are what let a
                // dispatcher fit a second run in rather than reach for a
                // different truck.
                const times = busy ? truckBookings(deliveries, t.id, day, draft.id).map((b) => fmtHour(b.start)).join(', ') : ''
                const why = workshop ? 'in maintenance that day' : busy ? `booked ${times}` : null
                return (
                  <option key={t.id} value={t.id}>
                    {t.plateNumber}{why ? ` — ${why}` : ''}
                  </option>
                )
              })}
            </Select>
          </Field>
          {chosenTruck && bans.length > 0 && (
            <BanWarning
              plate={chosenTruck.plateNumber}
              out={`${fmtHour(tripStartHour(draft))}–${fmtHour(tripStartHour(draft) + hours)} on ${fmtDate(draft.scheduleDate)}`}
              bans={bans}
              clearAt={clearAt}
              clearTrucks={clearTrucks}
              onLeaveAt={(t) => set('scheduleTime', t)}
              onTruck={(id) => set('truckId', id)}
            />
          )}
          {chosenTruck && (
            <TruckDayStrip
              deliveries={deliveries}
              truckId={chosenTruck.id}
              plate={chosenTruck.plateNumber}
              day={day}
              tripId={draft.id}
              start={draft.scheduleTime ? tripStartHour(draft) : null}
              hours={hours}
              inBan={bans.length > 0}
              rulesOff={checks?.fuelTankersExempt ? 'coding and truck bans off: fuel-tanker exemption is on (Coding & truck ban page)' : undefined}
              bans={banWindows.map((b) => ({ start: b.startTime, end: b.endTime, label: b.plateEndsWith.length > 0 ? 'Number coding' : 'Truck ban' }))}
              onPick={(t) => set('scheduleTime', t)}
            />
          )}
          <div className="col-span-2 rounded-[10px] border border-line bg-paper p-[10px]">
            <div className="flex items-baseline gap-[8px]">
              <span className="font-meta text-[11px] font-semibold uppercase tracking-[.08em] text-mut">Times</span>
              <span className="font-meta text-[12px] text-mut">
                {!draft.scheduleTime ? 'Click the truck’s day above to set when it leaves.'
                  : !draft.travelEstimate ? 'Plan the route for an arrival time.'
                  : 'From the departure and the planned route.'}
              </span>
              <RowAction
                verb="edit"
                label={editingTimes ? 'Done editing times' : 'Edit the times by hand'}
                className="ml-auto"
                onClick={() => setEditingTimes((v) => !v)}
              />
            </div>
            {editingTimes ? (
              <div className="mt-[8px] grid grid-cols-2 gap-x-4">
                <Field label="Leaves the depot at">
                  <Input type="time" value={draft.scheduleTime ?? ''} onChange={(e) => set('scheduleTime', e.target.value)} />
                </Field>
                <Field label="ETA at the customer" hint="Set by hand, it stays until the departure or route changes.">
                  <Input
                    type="datetime-local"
                    value={toLocalInput(draft.etaAt)}
                    onChange={(e) => set('etaAt', e.target.value ? new Date(e.target.value).toISOString() : undefined)}
                  />
                </Field>
              </div>
            ) : (
              <dl className="m-0 mt-[8px] grid grid-cols-3 gap-x-4">
                <TimeFact label="Leaves the depot" value={draft.scheduleTime ? fmtHour(tripStartHour(draft)) : '—'} />
                <TimeFact
                  label="ETA at the customer"
                  value={draft.etaAt ? fmtHour(hourOf(draft.etaAt)) : '—'}
                  note={draft.travelEstimate ? `${fmtHours(draft.travelEstimate.minutesOneWay / 60)} drive` : undefined}
                />
                <TimeFact
                  label="Back at the depot"
                  value={draft.scheduleTime ? fmtHour(tripStartHour(draft) + tripHours(draft)) : '—'}
                  note={draft.scheduleTime ? `tied up ${fmtHours(tripHours(draft))}` : undefined}
                />
              </dl>
            )}
          </div>
        </div>

        <FormSection>Crew</FormSection>
        <div className="grid grid-cols-2 gap-x-4 gap-y-[14px]">
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
            <FormSection>Documents going out</FormSection>
            <div className="grid gap-3">
              {docs.dispatch.map((slot) => (
                <Field
                  key={slot}
                  label={`${slotLabel(slot)} no.`}
                  hint={slot === receipt ? 'Issued here and sent with the load; it comes back signed at delivery.' : undefined}
                >
                  <div className="flex gap-2">
                    <Input
                      value={draft.documents?.[slot]?.referenceNo ?? ''}
                      placeholder={slot === receipt ? 'e.g. DR-2026-00187' : 'e.g. DS-2026-00187'}
                      onChange={(e) => setDocRef(slot, e.target.value)}
                    />
                    {slot === receipt && !draft.documents?.[slot]?.referenceNo && (
                      <button
                        type="button"
                        disabled={allocatingDr}
                        onClick={async () => {
                          setAllocatingDr(true)
                          try { setDocRef(slot, await allocateReference('DR')) } catch (e) { onNotice(e instanceof Error ? e.message : 'Couldn’t get a DR number.') } finally { setAllocatingDr(false) }
                        }}
                        className="shrink-0 cursor-pointer rounded-[10px] border border-inputline bg-white px-3 text-[12px] font-semibold text-tealbtn hover:bg-fill2 disabled:opacity-50"
                      >
                        {allocatingDr ? '…' : 'Get number'}
                      </button>
                    )}
                  </div>
                </Field>
              ))}
            </div>
            <div className="mt-3">
              <DocumentUpload tbl="deliveries" recordId={delivery.id} slots={docs.dispatch.filter((sl) => sl !== receipt)} />
            </div>
          </>
        )}
      </StageBlock>

      {/* ---- 3. Delivery ---------------------------------------------------
          The far end, which is only the signing: the receipt was issued at
          dispatch and rode with the load. Whoever takes the signed copy
          records it - the driver on return, or the office if it arrives as a
          photo - which is why this stage names no single role. */}
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
              { label: 'Signed on', value: draft.receivedOn ? fmtDate(draft.receivedOn) : '—' },
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
          {movementType(draft) === 'delivery_to_client' ? (
            <Field label={`${slotLabel(receipt)} no.`} hint="Issued at dispatch. Change it here only if a different copy was signed.">
              <Input
                value={draft.documents?.[receipt]?.referenceNo ?? ''}
                placeholder="Set at dispatch"
                onChange={(e) => setDocRef(receipt, e.target.value)}
              />
            </Field>
          ) : (
            <Field label={`${slotLabel(receipt)} no.`} hint="The number on the counterparty's own document.">
              <Input
                value={draft.documents?.[receipt]?.referenceNo ?? ''}
                placeholder="e.g. DR-2026-00187"
                onChange={(e) => setDocRef(receipt, e.target.value)}
              />
            </Field>
          )}
          <Field label="Signed on" hint="The date on the signed copy - not always the day it reached the office.">
            <Input
              type="date"
              value={(draft.receivedOn ?? '').slice(0, 10)}
              onChange={(e) => set('receivedOn', e.target.value)}
            />
          </Field>
          <Field label="Signed by" span2 hint="The person at the far end who signed for the load, not the crew.">
            <Input
              value={draft.receivedBy ?? ''}
              placeholder="Name on the signed copy"
              onChange={(e) => set('receivedBy', e.target.value)}
            />
          </Field>
        </div>
        <p className="m-0 mt-3 mb-[6px] font-meta text-[12px] text-mut">Signed copy</p>
        <DocumentUpload tbl="deliveries" recordId={delivery.id} slots={[receipt]} />
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
      {planning && origin && (
        <RoutePlanner
          origin={origin}
          address={draft.deliveryAddress ?? ''}
          destination={draft.destination}
          unloadMinutes={draft.travelEstimate?.unloadMinutes}
          leaves={draft.scheduleTime ? `${fmtDate(draft.scheduleDate)} · ${draft.scheduleTime}` : undefined}
          onClose={() => setPlanning(false)}
          onUse={({ estimate, destination, hours, address }) => {
            // The planner's address follows its pin, so a pin dropped on the
            // map comes back here as the delivery address too.
            setForm((f) => ({ ...f, travelEstimate: estimate, destination, durationHours: hours, ...(address ? { deliveryAddress: address } : {}) }))
            setPlanning(false)
          }}
        />
      )}
      </fieldset>
    </Dialog>
  )
}

export { CREW_ROLES, CHECKLIST_ITEMS }

/** An ISO instant as the local wall-clock value a datetime-local input wants. */
function toLocalInput(iso?: string) {
  if (!iso) return ''
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
const hourOf = (iso: string) => { const d = new Date(iso); return d.getHours() + d.getMinutes() / 60 }

function TimeFact({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <dt className="font-meta text-[11.5px] text-mut">{label}</dt>
      <dd className="tnum m-0 mt-[2px] text-[18px] font-semibold leading-none">{value}</dd>
      {note && <dd className="m-0 mt-[3px] font-meta text-[11.5px] text-faint">{note}</dd>}
    </div>
  )
}

/**
 * The ban, where the choice is made.
 *
 * The rail listed a clash in twelve-point red under the plate, which a
 * dispatcher filling in the truck and the time never looked across at; the
 * trip was booked and the fleet page found it later. This sits between the
 * truck picker and the day strip - the two controls that cause it - and says
 * which rule, when it lifts, and which trucks would be clear, each one a
 * click away.
 */
function BanWarning({ plate, out, bans, clearAt, clearTrucks, onLeaveAt, onTruck }: {
  plate: string
  /** The hours the truck is out, with the day. */
  out: string
  bans: TruckBanRule[]
  clearAt: string | null
  clearTrucks: Truck[]
  onLeaveAt: (time: string) => void
  onTruck: (truckId: string) => void
}) {
  return (
    <div role="alert" className="col-span-2 rounded-[10px] border border-redbright/60 bg-redbadge p-[12px] fade-in">
      <div className="flex items-start gap-[10px]">
        <span className="mt-[1px] grid size-[24px] shrink-0 place-items-center rounded-full bg-redf text-white">
          <TriangleAlert size={14} strokeWidth={2.4} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-meta text-[14px] font-semibold text-redtext">{plate} can’t be out {out}</div>
          <div className="mt-[2px] font-meta text-[12px] text-redtext/80">
            {bans.length === 1 ? 'The truck would be on the road while a rule is in force. Saving books the trip into it.'
              : `The truck would be on the road while ${bans.length} rules are in force. Saving books the trip into them.`}
          </div>
          <ul className="m-0 mt-[8px] flex list-none flex-col gap-[4px] p-0">
            {bans.map((b) => (
              <li key={b.id} className="flex flex-wrap items-baseline gap-x-[8px] font-meta text-[12px] text-redtext">
                <span className="rounded-[4px] bg-white/70 px-[6px] py-[1px] font-semibold tnum">{b.startTime}–{b.endTime}</span>
                <span className="font-semibold">{b.plateEndsWith.length > 0 ? 'Number coding' : 'Truck ban'}</span>
                <span>· {b.authority}{b.area ? `, ${b.area}` : ''}</span>
                <span className="text-redtext/75">
                  {b.plateEndsWith.length > 0
                    ? `plates ending in ${b.plateEndsWith.join(', ')}`
                    : b.appliesTo === 'heavy' ? 'heavy trucks' : b.appliesTo === 'light' ? 'light trucks' : 'all trucks'}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-[10px] flex flex-wrap items-center gap-[6px]">
            {clearAt && (
              <button
                type="button"
                onClick={() => onLeaveAt(clearAt)}
                className="rounded-[6px] bg-redf px-[10px] py-[4px] font-meta text-[12px] font-semibold text-white transition hover:bg-redtext active:scale-[.97]"
              >
                Leave at {clearAt} instead
              </button>
            )}
            {clearTrucks.length > 0 ? (
              <>
                <span className="font-meta text-[12px] text-redtext/80">{clearAt ? 'or switch to' : 'Switch to'}</span>
                {clearTrucks.slice(0, 4).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => onTruck(t.id)}
                    className="rounded-[6px] border border-redbright/60 bg-white px-[8px] py-[3px] font-meta text-[12px] font-semibold text-redtext transition hover:bg-redbadge active:scale-[.97]"
                  >
                    {t.plateNumber}
                  </button>
                ))}
                {clearTrucks.length > 4 && <span className="font-meta text-[12px] text-redtext/70">+{clearTrucks.length - 4} more in the list</span>}
              </>
            ) : (
              <span className="font-meta text-[12px] text-redtext/80">{clearAt ? 'No other free truck is clear for these hours.' : 'No later departure that day clears the run, and no other free truck is clear for these hours.'}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
