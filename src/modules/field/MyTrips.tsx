import { useState } from 'react'
import { PhoneSkeleton } from '../../components/ui'
import { AlertTriangle, Phone, Truck, User } from 'lucide-react'
import { useTables } from '../../lib/data'
import { repos } from '../../data/repo'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../components/Toast'
import { isPending } from '../../lib/approvals'
import { dayISO, fmtDate, fmtDateTime, label, todayISO } from '../../lib/format'
import { CHECKLIST_GROUPS, CHECKLIST_ITEMS, CHECKLIST_SIGNATORIES, MOVEMENT_LABELS, checklistProgress, movementType, needsChecklist } from '../../lib/logistics'
import SignaturePad from '../../components/SignaturePad'
import {
  STAGE_ACTION, TRIP_STAGES, advancePatch, gapLabel, receiptSlot, stageGaps, stageOf, stageState,
} from '../../lib/tripStages'
import { slotLabel } from '../../lib/attachments'
import PhotoCapture from '../../components/PhotoCapture'
import {
  Action, BottomSheet, Card, CardList, GapChips, CardNote, Dock, Eyebrow, FieldBody, FieldCheck, FieldEmpty, FieldField,
  FieldHeader, FieldInput, FieldRow, FieldSectionLabel, FieldTabs, IconRow, Pill, SheetHeader,
  ScreenStack, Stage, StageProgress, Timeline, useFieldWindow,
} from './shell'
import type { Delivery, DeliveryStatus, PreDispatchChecklist } from '../../data/types'

/**
 * The crew's screens: the trips this person is on, and what they can record.
 *
 * Deliberately not the dispatcher's trip view with fields removed - the
 * questions are different. A dispatcher asks which trips exist and who is on
 * them; a pahinante asks what is mine today and what do I have to do to it. So
 * the screen leads with the one trip that wants something now, and the rest is
 * a quiet list.
 *
 * What can be recorded here is the same list the server enforces (see
 * server/scope.ts): the checklist, the stage, the receipt, the outcome. The
 * schedule, the truck and the crew are dispatch's, and are shown as facts.
 */
export default function MyTrips() {
  const { seat } = useAuth()
  const [openId, setOpenId] = useState<string | null>(null)
  const data = useTables(['deliveries', 'trucks', 'personnel'] as const)
  if (!data) return <PhoneSkeleton />
  const { deliveries, trucks, personnel } = data

  // The server already filters this list to the trips this seat is crewed on;
  // there is nothing to filter again here, and nothing else to see.
  const mine = [...deliveries].sort((a, b) => b.scheduleDate.localeCompare(a.scheduleDate))
  const open = mine.find((d) => d.id === openId)
  const plate = (id?: string) => trucks.find((t) => t.id === id)?.plateNumber

  if (open) {
    return (
      <ScreenStack screen={`trip:${open.id}`} depth={1}>
        <TripSheet
          trip={open}
          plate={plate(open.truckId)}
          crewName={(id?: string) => personnel.find((p) => p.id === id)?.name}
          seat={seat}
          onBack={() => setOpenId(null)}
        />
      </ScreenStack>
    )
  }
  return (
    <ScreenStack screen="list" depth={0}>
      <TripList trips={mine} plate={plate} onOpen={setOpenId} />
    </ScreenStack>
  )
}


/** What this trip is asking the crew for, if anything. */
function tripNeed(d: Delivery): string | null {
  const stage = stageOf(d.status)
  const progress = checklistProgress(d.checklist)
  if (stage === 'dispatch' && needsChecklist(d) && !progress.complete) {
    return `Checklist ${progress.answered} of ${progress.total} complete`
  }
  if (stage === 'delivery') return 'Delivery receipt required'
  return null
}

/**
 * The list, with its own tab and search state.
 *
 * Separate from MyTrips because that component returns the sheet early, and a
 * hook below an early return is a hook that sometimes does not run - React
 * counts them and throws.
 */
function TripList({ trips, plate, onOpen }: {
  trips: Delivery[]
  plate: (id?: string) => string | undefined
  onOpen: (id: string) => void
}) {
  const [tab, setTab] = useState<'current' | 'past'>('current')
  const [q, setQ] = useState('')
  const [searching, setSearching] = useState(false)
  const today = todayISO()

  // Today's trips are not done with at midnight: anything still moving belongs
  // in front of the crew until it is delivered or failed.
  const live = (d: Delivery) => stageOf(d.status) !== 'close'
  const byDay = (a: Delivery, b: Delivery) => a.scheduleDate.localeCompare(b.scheduleDate) || (a.scheduleTime ?? '').localeCompare(b.scheduleTime ?? '')
  const now = trips.filter((d) => live(d) && dayISO(d.scheduleDate) <= today).sort(byDay)
  const upcoming = trips.filter((d) => live(d) && dayISO(d.scheduleDate) > today).sort(byDay)
  // Newest first: the past is read backwards from today.
  const done = trips.filter((d) => !live(d)).sort((a, b) => byDay(b, a))

  // Everything on the row, because that is what somebody searching has in hand:
  // an address, a plate, or the receipt number on the paper they are holding.
  const needle = q.trim().toLowerCase()
  const hit = (d: Delivery) => !needle || [
    d.deliveryAddress,
    plate(d.truckId),
    d.contactPerson,
    Object.values(d.documents ?? {}).map((x) => x?.referenceNo).join(' '),
  ].filter(Boolean).join(' ').toLowerCase().includes(needle)

  const nowHits = now.filter(hit)
  const laterHits = upcoming.filter(hit)
  const doneHits = done.filter(hit)
  // One card leads: the trip that wants something now. Never while searching -
  // a search is a question about the whole list.
  const hero = tab === 'current' && !needle ? nowHits.find((d) => tripNeed(d)) ?? nowHits[0] : undefined
  const restNow = hero ? nowHits.filter((d) => d.id !== hero.id) : nowHits
  // The long lists page; upcoming is short by nature and shows whole.
  const { visible, more } = useFieldWindow(tab === 'current' ? restNow : doneHits)

  if (trips.length === 0) {
    return (
      <>
        <FieldHeader title="My trips" />
        <FieldBody><FieldEmpty>No trips have been assigned to you.</FieldEmpty></FieldBody>
      </>
    )
  }

  const row = (d: Delivery) => (
    <FieldRow
      key={d.id}
      day={d.scheduleDate}
      title={d.deliveryAddress || 'Address not set'}
      meta={[d.scheduleTime, plate(d.truckId)].filter(Boolean).join(' · ')}
      need={tab === 'current' ? tripNeed(d) : undefined}
      note={label(d.status)}
      onOpen={() => onOpen(d.id)}
    />
  )
  const empty = tab === 'current' ? nowHits.length + laterHits.length === 0 : doneHits.length === 0

  return (
    <>
      <FieldHeader
        title="My trips"
        searching={searching}
        onSearch={() => { setSearching((v) => !v); setQ('') }}
        search={{ value: q, onChange: setQ, placeholder: 'Address, plate or receipt' }}
      />
      {/* Two tabs, not three: what is still to do - today and the days after,
          in one scroll - and what is finished. */}
      <FieldTabs
        value={tab}
        onChange={(t) => { setTab(t); setQ(''); setSearching(false) }}
        tabs={[
          { key: 'current', label: 'Current', count: now.length + upcoming.length },
          { key: 'past', label: 'Past', count: done.length },
        ]}
      />

      <FieldBody>
        {empty ? (
          <FieldEmpty>{needle ? `No results for “${q}”.` : tab === 'current' ? 'Nothing scheduled.' : 'No completed trips yet.'}</FieldEmpty>
        ) : tab === 'current' ? (
          <>
            {hero && <TripHero trip={hero} plate={plate(hero.truckId)} onOpen={() => onOpen(hero.id)} />}
            {visible.length > 0 && (
              <>
                <FieldSectionLabel>{hero ? 'Also active' : 'Active'}</FieldSectionLabel>
                <CardList key={`now:${needle}`}>{visible.map(row)}</CardList>
                {more}
              </>
            )}
            {laterHits.length > 0 && (
              <>
                <FieldSectionLabel>Upcoming</FieldSectionLabel>
                <CardList key={`later:${needle}`}>{laterHits.map(row)}</CardList>
              </>
            )}
          </>
        ) : (
          <>
            <FieldSectionLabel>Completed</FieldSectionLabel>
            <CardList key={`past:${needle}`}>{visible.map(row)}</CardList>
            {more}
          </>
        )}
      </FieldBody>
    </>
  )
}

function TripHero({ trip, plate, onOpen }: { trip: Delivery; plate?: string; onOpen: () => void }) {
  const need = tripNeed(trip)
  return (
    <Card lead>
      <Eyebrow tone={need ? 'act' : 'calm'}>{label(trip.status)}</Eyebrow>
      <p className="m-0 mt-[9px] text-[19px] font-semibold leading-[1.25] tracking-[-0.01em]">
        {trip.deliveryAddress || 'Address not set'}
      </p>
      <IconRow icon={<Truck size={15} strokeWidth={1.8} />}>
        {[plate, trip.scheduleTime].filter(Boolean).join(' · ') || fmtDate(trip.scheduleDate)}
      </IconRow>
      {(trip.contactPerson || trip.contactNumber) && (
        <IconRow icon={<Phone size={15} strokeWidth={1.8} />}>
          {[trip.contactPerson, trip.contactNumber].filter(Boolean).join(' · ')}
        </IconRow>
      )}
      {need && (
        <CardNote>
          {stageOf(trip.status) === 'delivery'
            ? 'Record the delivery receipt before leaving the customer site.'
            : `${need}. Complete the checklist before departure.`}
        </CardNote>
      )}
      <Action onClick={onOpen}>{STAGE_ACTION[stageOf(trip.status)]?.label ?? 'Open trip'}</Action>
    </Card>
  )
}

/** One trip: the facts, then where it has got to and what it wants next. */
function TripSheet({ trip, plate, crewName, seat, onBack }: {
  trip: Delivery
  plate?: string
  crewName: (id?: string) => string | undefined
  seat: { id: string; name: string } | null
  onBack: () => void
}) {
  const toast = useToast()
  const [saving, setSaving] = useState(false)
  const [receiptNo, setReceiptNo] = useState(trip.documents?.[receiptSlot(trip)]?.referenceNo ?? '')
  const [receivedBy, setReceivedBy] = useState(trip.receivedBy ?? '')
  const [receivedOn, setReceivedOn] = useState((trip.receivedOn ?? todayISO()).slice(0, 10))

  const stage = stageOf(trip.status)
  const progress = checklistProgress(trip.checklist)
  const slot = receiptSlot(trip)

  async function write(patch: Partial<Delivery>, note?: string) {
    setSaving(true)
    try {
      const result = await repos.deliveries.update(trip.id, patch)
      if (isPending(result)) toast(result.message)
      else if (note) toast(note)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Unable to save changes.')
    } finally {
      setSaving(false)
    }
  }

  const tick = (key: keyof PreDispatchChecklist, value: boolean) =>
    write({ checklist: { ...(trip.checklist ?? {}), [key]: value } as PreDispatchChecklist })

  /** The gaps at the moment a confirm was pressed, held while the driver
   *  decides whether to go back and fill them in or carry on. */
  const [confirming, setConfirming] = useState<{ next: DeliveryStatus; missing: string[] } | null>(null)

  /** Pressing the stage's button: with everything filled in it goes straight
   *  through; with gaps, it asks first. A driver at a tailgate taps fast. */
  function tryAdvance(next: DeliveryStatus) {
    const missing = next === 'failed' ? [] : gapList
    if (missing.length > 0) { setConfirming({ next, missing }); return }
    void advance(next)
  }

  async function advance(next: DeliveryStatus) {
    // The receipt is typed here and moved on in the same write, so a tap on
    // Confirm delivery cannot file a delivery whose reference is still sitting
    // in an unsaved field.
    const extra: Partial<Delivery> = next === 'delivered' || next === 'failed'
      ? {
        documents: { ...(trip.documents ?? {}), [slot]: { ...(trip.documents?.[slot] ?? {}), referenceNo: receiptNo } },
        receivedBy: receivedBy || undefined,
        receivedOn: receivedOn || undefined,
      }
      // Dispatch files the DR number typed on this screen in the same write.
      : next === 'in_transit' && receiptNo
        ? { documents: { ...(trip.documents ?? {}), [slot]: { ...(trip.documents?.[slot] ?? {}), referenceNo: receiptNo } } }
        : {}
    await write(advancePatch(trip, next, seat, extra), 'Trip updated.')
    onBack()
  }

  const gapList = stageGaps(
    { ...trip, documents: { ...(trip.documents ?? {}), [slot]: { referenceNo: receiptNo } }, receivedBy },
    stage,
    // The signed copy is photographed on this screen, so the gap worth naming
    // to a phone is who signed - the file is in front of them either way.
    true,
  )
  const action = STAGE_ACTION[stage]

  return (
    <>
      <SheetHeader
        back={onBack}
        pill={<Pill text={label(trip.status)} tone={stage === 'close' ? 'good' : stage === 'delivery' ? 'watch' : 'plain'} />}
        title={trip.deliveryAddress || 'Trip'}
        sub={`${MOVEMENT_LABELS[movementType(trip)]} · ${fmtDate(trip.scheduleDate)}${trip.scheduleTime ? ` · ${trip.scheduleTime}` : ''}`}
      />

      <FieldBody>
        {/* Dispatch's decisions, as facts. A crew seat cannot change any of
            these - the server refuses the write by name - so they are not
            offered as fields that quietly fail. */}
        <Card>
          <IconRow icon={<Truck size={15} strokeWidth={1.8} />}>{plate ?? 'Truck not assigned'}</IconRow>
          <IconRow icon={<User size={15} strokeWidth={1.8} />}>{crewName(trip.driverId) ?? 'Driver not assigned'}</IconRow>
          <IconRow icon={<Phone size={15} strokeWidth={1.8} />}>
            {[trip.contactPerson, trip.contactNumber].filter(Boolean).join(' · ') || 'No contact on file'}
          </IconRow>
        </Card>

        <FieldSectionLabel>Progress</FieldSectionLabel>
        <Card>
          <Timeline>
            {TRIP_STAGES.map((def, i) => {
              const state = stageState(def.key, trip.status)
              const stamp = trip.stamps?.[def.key]
              return (
                <Stage
                  key={def.key}
                  state={state}
                  last={i === TRIP_STAGES.length - 1}
                  title={STAGE_TITLES[def.key]}
                  meta={
                    stamp ? `${stamp.byName ?? 'Unknown'} · ${fmtDateTime(stamp.at)}`
                      : state === 'now' ? STAGE_NOW_NOTE[def.key]
                      : state === 'later' ? STAGE_LATER_NOTE[def.key]
                      : undefined
                  }
                >
                  {/* The delivery receipt goes out with the truck, so its
                      number is typed here, at dispatch - the gap named above
                      the button is one the crew can close on this screen. */}
                  {state === 'now' && def.key === 'dispatch' && movementType(trip) === 'delivery_to_client' && (
                    <FieldField label={`${slotLabel(slot)} no.`} hint="From the printed DR going out with the truck">
                      <FieldInput
                        value={receiptNo}
                        placeholder="e.g. DR-2026-00187"
                        onChange={(e) => setReceiptNo(e.target.value)}
                      />
                    </FieldField>
                  )}
                  {state === 'now' && def.key === 'dispatch' && needsChecklist(trip) && (
                    <>
                      <StageProgress done={progress.answered} total={progress.total} />
                      {CHECKLIST_GROUPS.map((g) => (
                        <div key={g}>
                          <FieldSectionLabel>{g}</FieldSectionLabel>
                          <CardList>
                            {CHECKLIST_ITEMS.filter((i) => i.group === g).map((item) => (
                              <FieldCheck
                                key={item.key}
                                checked={Boolean(trip.checklist?.[item.key])}
                                disabled={saving}
                                onChange={(v) => tick(item.key, v)}
                              >
                                {item.label}
                              </FieldCheck>
                            ))}
                          </CardList>
                        </div>
                      ))}
                      {/* Signed with a finger, here on the phone - which is
                          where the crew are when they sign. */}
                      <FieldSectionLabel>Signatures</FieldSectionLabel>
                      <div className="mb-[12px] flex flex-col gap-[10px]">
                        {CHECKLIST_SIGNATORIES.map((sig) => (
                          <SignaturePad
                            key={sig.role}
                            label={sig.label}
                            name={sig.role === 'dispatcher' ? (seat?.name ?? '') : (crewName(sig.role === 'driver' ? trip.driverId : trip.pahinanteId) ?? '')}
                            value={trip.checklist?.signatures?.[sig.role]}
                            onChange={(v) => write({ checklist: { ...(trip.checklist ?? {}), signatures: { ...(trip.checklist?.signatures ?? {}), [sig.role]: v } } as PreDispatchChecklist })}
                          />
                        ))}
                      </div>
                    </>
                  )}

                  {state === 'now' && def.key === 'delivery' && (
                    <>
                      {/* A delivery's DR number was typed at dispatch, when
                          the paper went out with the truck, so here it is
                          only shown. A pickup's receipt is the supplier's or
                          customer's paper, first seen at the far end - that
                          number is typed here. */}
                      {movementType(trip) === 'delivery_to_client' ? (
                        <p className="m-0 mb-[12px] flex items-baseline justify-between gap-[10px] rounded-[10px] bg-fill2 px-[12px] py-[9px]">
                          <span className="font-meta text-[12px] font-semibold text-mut">{slotLabel(slot)} no.</span>
                          <span className={`tnum text-[14px] font-semibold ${trip.documents?.[slot]?.referenceNo ? '' : 'font-normal text-faint'}`}>
                            {trip.documents?.[slot]?.referenceNo || 'Not recorded at dispatch'}
                          </span>
                        </p>
                      ) : (
                        <FieldField label={`${slotLabel(slot)} no.`} hint="From the paper handed over at the site.">
                          <FieldInput
                            value={receiptNo}
                            placeholder="e.g. DR-2026-00187"
                            onChange={(e) => setReceiptNo(e.target.value)}
                          />
                        </FieldField>
                      )}
                      <FieldField label="Signed by">
                        <FieldInput
                          value={receivedBy}
                          placeholder="Name on the signed copy"
                          onChange={(e) => setReceivedBy(e.target.value)}
                        />
                      </FieldField>
                      <FieldField label="Signed on">
                        <FieldInput type="date" value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} />
                      </FieldField>
                      {/* The signed receipt, photographed at the gate - or
                          attached, if it was photographed already. */}
                      <PhotoCapture tbl="deliveries" recordId={trip.id} slot={slot} />
                    </>
                  )}
                </Stage>
              )
            })}
          </Timeline>
        </Card>

        {action && (
          <Dock gap={<GapChips items={gapList.map(gapLabel)} />}>
            <Action onClick={() => tryAdvance(action.next)} disabled={saving}>{action.label}</Action>
            {stage === 'delivery' && (
              <Action tone="ghost" onClick={() => tryAdvance('failed')} disabled={saving}>Mark as failed</Action>
            )}
          </Dock>
        )}
        {confirming && (
          <BottomSheet label="Something is missing" onClose={() => setConfirming(null)}>
            <div className="flex items-start gap-[12px]">
              <span className="mt-[2px] inline-flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-full bg-amberbadge text-ambertext">
                <AlertTriangle size={18} strokeWidth={2} />
              </span>
              <span className="min-w-0">
                <span className="block text-[17px] font-semibold leading-[1.25]">Something is missing</span>
                <span className="mt-[2px] block font-meta text-[13px] text-mut">You can still go ahead, but the office will have to chase it.</span>
              </span>
            </div>
            <ul className="m-0 my-[14px] flex list-none flex-col gap-[6px] p-0">
              {confirming.missing.map((m) => (
                <li key={m} className="flex items-center gap-[8px] rounded-[8px] bg-fill2 px-[12px] py-[9px] text-[14px]">
                  <span className="h-[6px] w-[6px] shrink-0 rounded-full bg-ambertext" aria-hidden />
                  {gapLabel(m)}
                </li>
              ))}
            </ul>
            <Action onClick={() => setConfirming(null)}>Go back and fill it in</Action>
            <Action tone="ghost" onClick={() => { const n = confirming.next; setConfirming(null); void advance(n) }} disabled={saving}>
              Continue anyway
            </Action>
          </BottomSheet>
        )}
      </FieldBody>
    </>
  )
}

/** Stage names as the crew would say them, rather than as the board labels them. */
const STAGE_TITLES: Record<string, string> = {
  plan: 'Scheduled',
  dispatch: 'Pre-dispatch',
  delivery: 'Delivery',
  close: 'Closed',
}

const STAGE_NOW_NOTE: Record<string, string> = {
  plan: 'Awaiting release by the office.',
  dispatch: 'Complete the vehicle checklist before departure.',
  delivery: 'Record the receipt details at the customer site.',
  close: 'Outcome recorded by the office.',
}

const STAGE_LATER_NOTE: Record<string, string> = {
  plan: 'Scheduled by the office.',
  dispatch: 'DR number, checklist and signatures before departure.',
  delivery: 'DR signed by the customer on arrival.',
  close: 'Outcome recorded by the office.',
}
