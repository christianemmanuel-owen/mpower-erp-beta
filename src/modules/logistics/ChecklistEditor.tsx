import { useState } from 'react'
import { Field, GhostButton, Input, Textarea } from '../../components/ui'
import SignaturePad from '../../components/SignaturePad'
import { CHECKLIST_GROUPS, CHECKLIST_ITEMS, CHECKLIST_SIGNATORIES, MOVEMENT_LABELS, checklistProgress, emptyChecklist, movementType } from '../../lib/logistics'
import { allocateReference } from '../../lib/attachments'
import { printDocument } from '../../lib/printDoc'
import { fmtCurrency, fmtDate } from '../../lib/format'
import { useAuth } from '../../lib/auth'
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
  const { seat } = useAuth()
  const checklist = draft.checklist ?? emptyChecklist()
  const progress = checklistProgress(draft.checklist)
  const name = (id?: string) => personnel.find((p) => p.id === id)?.name ?? '—'
  const plate = (id: string) => trucks.find((t) => t.id === id)?.plateNumber ?? '—'

  const toggle = (key: keyof PreDispatchChecklist, value: boolean) =>
    onChange({ ...checklist, [key]: value })

  // No "tick all". Every box starts empty and is ticked by hand - the client's
  // rule, and the only way the signed slip means somebody looked.

  const signatoryName = (role: 'driver' | 'pahinante' | 'dispatcher') =>
    role === 'driver' ? name(checklist.driverId ?? draft.driverId)
    : role === 'pahinante' ? name(checklist.pahinanteId ?? draft.pahinanteId)
    // Dispatch personnel is whoever is at the desk - the signed-in seat.
    : (seat?.name ?? name(checklist.managerId ?? draft.managerId))

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
        ...CHECKLIST_GROUPS.map((g) => ({
          kind: 'checklist' as const,
          heading: g,
          columns: 2 as const,
          items: CHECKLIST_ITEMS.filter((i) => i.group === g).map((i) => ({ label: i.label, checked: Boolean(checklist[i.key]) })),
        })),
        ...(checklist.notes ? [{ kind: 'note' as const, text: checklist.notes }] : []),
        {
          kind: 'signatures',
          signatories: [
            ...CHECKLIST_SIGNATORIES.map((sig) => ({
              role: sig.label,
              name: checklist.signatures?.[sig.role]?.name || signatoryName(sig.role),
              image: checklist.signatures?.[sig.role]?.image,
              signedAt: checklist.signatures?.[sig.role]?.at,
            })),
            { role: 'Loading personnel', name: name(checklist.loaderId ?? draft.loaderId) },
            { role: 'Guard on duty', name: name(checklist.guardId ?? draft.guardId) },
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
          <p className="m-0 font-meta text-[10px] font-semibold uppercase tracking-[.09em] text-mut">Checklist</p>
          <span className="font-meta text-[12px] text-faint">{progress.answered} of {progress.total} ticked</span>
        </div>

        {/* Four blocks, two columns each: the crew walk the vehicle first
            (BLOWBAGETS), then the devices, then what they carry, then the load. */}
        {CHECKLIST_GROUPS.map((g) => (
          <div key={g} className="border-b border-linesoft last:border-b-0">
            <p className="m-0 bg-paper/60 px-[12px] py-[5px] font-meta text-[10px] font-semibold uppercase tracking-[.09em] text-sec">{g}</p>
            <div className="grid grid-cols-2">
              {CHECKLIST_ITEMS.filter((i) => i.group === g).map((item) => (
                <label
                  key={item.key}
                  className="flex cursor-pointer items-center gap-[10px] px-[12px] py-[6px] text-[13px] hover:bg-paper"
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
            </div>
          </div>
        ))}

        {/* The crew sign on screen - driver, pahinante, dispatch personnel -
            and the slip prints with the signatures on it. */}
        <div className="border-t border-line bg-paper px-[12px] py-[10px]">
          <div className="mb-[8px] flex items-baseline gap-3">
            <p className="m-0 font-meta text-[10px] font-semibold uppercase tracking-[.09em] text-mut">Signatures</p>
            <span className="font-meta text-[12px] text-faint">
              {progress.signed ? 'All signed' : `${progress.missingSignatures.join(', ')} still to sign`}
            </span>
          </div>
          {/* One signer per row: who on the left, the pad on the right. Three
              pads side by side left each one too narrow for a name and a
              pair of buttons at once. */}
          <div className="divide-y divide-linesoft">
            {CHECKLIST_SIGNATORIES.map((sig) => {
              const v = checklist.signatures?.[sig.role]
              const name = signatoryName(sig.role)
              return (
                <div key={sig.role} className="grid grid-cols-[170px_minmax(0,360px)] items-start gap-x-5 py-[10px] first:pt-0 last:pb-0">
                  <div className="pt-[2px]">
                    <p className="m-0 font-meta text-[11px] font-semibold uppercase tracking-[.08em] text-mut">{sig.label}</p>
                    <p className="m-0 mt-[3px] truncate text-[13px] font-semibold leading-[1.25]">{name || 'Not assigned'}</p>
                    <p className={`m-0 mt-[2px] font-meta text-[12px] ${v ? 'text-tealtext' : 'text-faint'}`}>
                      {v ? `Signed ${fmtDate(v.at)}` : 'Still to sign'}
                    </p>
                  </div>
                  <SignaturePad
                    layout="row"
                    label={sig.label}
                    name={name}
                    value={v}
                    onChange={(sv) => onChange({ ...checklist, signatures: { ...(checklist.signatures ?? {}), [sig.role]: sv } })}
                  />
                </div>
              )
            })}
          </div>
        </div>

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
