import { useState } from 'react'
import { Field, GhostButton, Input, Textarea } from '../../components/ui'
import { CHECKLIST_ITEMS, MOVEMENT_LABELS, checklistProgress, emptyChecklist, movementType } from '../../lib/logistics'
import { allocateReference } from '../../lib/attachments'
import { printDocument } from '../../lib/printDoc'
import { fmtCurrency, fmtDate } from '../../lib/format'
import type { Delivery, Personnel, PreDispatchChecklist, Truck } from '../../data/types'

/**
 * The pre-dispatch checklist - Exhibit A 1.5.
 *
 * Every row is a manual entry. The spec spells this out: "For clarity, these are
 * manual checklist entries. The System does not read device status directly.
 * Live device integration is (D) and depends on Secondary Features 2.8 and 2.9."
 *
 * That is why the GPS, fuel sensor and smart lock rows look exactly like the
 * tire and body-cam rows - they are all a person confirming they looked at the
 * vehicle. When the telematics and smart-lock feeds arrive, they belong in
 * fields beside these, not behind them: a device reporting "GPS online" is a
 * different claim from a dispatcher signing that they checked, and the signed
 * slip is the one that matters if a load goes missing.
 */
export default function ChecklistEditor({ draft, personnel, trucks, onChange, onNotice }: {
  draft: Delivery
  personnel: Personnel[]
  trucks: Truck[]
  onChange: (c: PreDispatchChecklist) => void
  onNotice: (message: string) => void
}) {
  const [allocating, setAllocating] = useState(false)
  const checklist = draft.checklist ?? emptyChecklist()
  const progress = checklistProgress(draft.checklist)
  const name = (id?: string) => personnel.find((p) => p.id === id)?.name ?? '—'
  const plate = (id: string) => trucks.find((t) => t.id === id)?.plateNumber ?? '—'

  const toggle = (key: keyof PreDispatchChecklist, value: boolean) =>
    onChange({ ...checklist, [key]: value })

  /** Ticks everything at once. Offered because the honest common case is a clean
   * vehicle and ten identical ticks - but it fills the visible boxes rather than
   * bypassing them, so what gets signed is still what was reviewed. */
  const tickAll = () =>
    onChange({ ...checklist, ...Object.fromEntries(CHECKLIST_ITEMS.map((i) => [i.key, true])) })

  async function printSlip() {
    let referenceNo = checklist.referenceNo
    if (!referenceNo) {
      setAllocating(true)
      try {
        referenceNo = await allocateReference('PDC')
        onChange({ ...checklist, referenceNo })
      } catch (e) {
        onNotice(e instanceof Error ? e.message : 'Couldn’t allocate a checklist number.')
        setAllocating(false)
        return
      } finally {
        setAllocating(false)
      }
    }

    const ok = printDocument(
      {
        title: 'Pre-dispatch checklist',
        referenceNo,
        date: draft.scheduleDate,
      },
      [
        {
          kind: 'fields',
          cells: [
            { label: 'Movement', value: MOVEMENT_LABELS[movementType(draft)] },
            { label: 'Truck', value: draft.truckId ? plate(draft.truckId) : '—' },
            { label: 'Driver', value: name(checklist.driverId ?? draft.driverId) },
            { label: 'Pahinante', value: name(checklist.pahinanteId ?? draft.pahinanteId) },
            { label: 'Loading personnel', value: name(checklist.loaderId ?? draft.loaderId) },
            { label: 'Guard on duty', value: name(checklist.guardId ?? draft.guardId) },
            { label: 'Manager', value: name(checklist.managerId ?? draft.managerId) },
            { label: 'Allowance issued', value: checklist.allowanceIssued ? fmtCurrency(checklist.allowanceIssued) : '—' },
            { label: 'Destination', value: draft.deliveryAddress || '—' },
            { label: 'Scheduled', value: `${fmtDate(draft.scheduleDate)}${draft.scheduleTime ? ` ${draft.scheduleTime}` : ''}` },
          ],
        },
        {
          kind: 'checklist',
          items: CHECKLIST_ITEMS.map((i) => ({ label: i.label, checked: Boolean(checklist[i.key]) })),
        },
        ...(checklist.notes ? [{ kind: 'note' as const, text: checklist.notes }] : []),
        {
          kind: 'signatures',
          signatories: [
            { role: 'Driver', name: name(checklist.driverId ?? draft.driverId) },
            { role: 'Loading personnel', name: name(checklist.loaderId ?? draft.loaderId) },
            { role: 'Guard on duty', name: name(checklist.guardId ?? draft.guardId) },
            { role: 'Manager', name: name(checklist.managerId ?? draft.managerId) },
          ],
        },
      ],
    )
    if (!ok) onNotice('Your browser blocked the print window - allow pop-ups for this site and try again.')
  }

  return (
    <div>
      <p className="m-0 mb-[12px] font-meta text-[12px] text-mut">
        Completed by hand before dispatch. The System does not read device status - ticking GPS, fuel sensor or
        smart lock records that someone checked, not that a device reported in.
      </p>

      <div className="mb-[14px] grid grid-cols-2 gap-x-4 gap-y-[14px]">
        <Field label="Allowance issued (₱)">
          <Input
            type="number" min={0} step="0.01" className="nospin tnum"
            value={checklist.allowanceIssued ?? ''}
            onChange={(e) => onChange({
              ...checklist,
              allowanceIssued: e.target.value === '' ? undefined : Number(e.target.value),
            })}
          />
        </Field>
        <Field label="Notes" span2>
          <Textarea
            value={checklist.notes ?? ''}
            placeholder="Anything the crew should know, or anything not right on the vehicle"
            onChange={(e) => onChange({ ...checklist, notes: e.target.value })}
          />
        </Field>
      </div>

      {/* One bordered list, the same shape as the printed slip: a header saying
          how far along it is, the ten items in the order they are signed for,
          and the print action at the foot of the thing it prints. The progress
          count lives here and in the rail; it used to be an amber sentence
          beside the button naming three outstanding items and "+7 more", which
          is neither the full list nor a number you can act on - the ticks
          themselves are the list. */}
      <div className="overflow-hidden rounded-[8px] border border-line">
        <div className="flex items-center gap-3 border-b border-linesoft bg-paper px-[12px] py-[7px]">
          <p className="m-0 font-meta text-[10px] font-semibold uppercase tracking-[.09em] text-mut">Checklist items</p>
          <span className="font-meta text-[12px] text-faint">{progress.answered} of {progress.total} ticked</span>
          <span className="ml-auto">
            <GhostButton onClick={tickAll}>Tick all</GhostButton>
          </span>
        </div>

        {CHECKLIST_ITEMS.map((item) => (
          <label
            key={item.key}
            className="flex cursor-pointer items-center gap-[10px] border-b border-linesoft px-[12px] py-[7px] text-[13px] last:border-b-0 hover:bg-paper"
          >
            <input
              type="checkbox"
              checked={Boolean(checklist[item.key])}
              onChange={(e) => toggle(item.key, e.target.checked)}
              className="h-[15px] w-[15px] cursor-pointer accent-ink"
            />
            {item.label}
          </label>
        ))}

        <div className="flex items-center gap-3 border-t border-line bg-paper px-[12px] py-[8px]">
          <GhostButton onClick={printSlip} disabled={allocating}>
            {allocating ? 'Allocating\u2026' : 'Print checklist'}
          </GhostButton>
          {/* Before printing this slot says what printing will do; afterwards it
              holds the number that came back. The number used to sit in a
              read-only Input that looked like something you could type in, and
              the trip's internal id was printed underneath it - an opaque
              string nobody has ever needed to read. */}
          {checklist.referenceNo ? (
            <span className="ml-auto text-right">
              <span className="block font-meta text-[12px] text-mut">Checklist no.</span>
              <span className="block tnum text-[13px] font-semibold leading-[1.2]">{checklist.referenceNo}</span>
            </span>
          ) : (
            <p className="m-0 ml-auto max-w-[320px] text-right font-meta text-[12px] text-faint">
              Printing allocates a checklist number and saves it with the trip.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
