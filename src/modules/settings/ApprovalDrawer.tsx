import { useMemo, useState } from 'react'
import { Check } from 'lucide-react'
import { Avatar, Dialog, Field, FormSection, GhostButton, Input, PrimaryButton, Select, WIDE_DIALOG } from '../../components/ui'
import { FormNav, useSectionNav, type FormNavSection } from '../../components/FormNav'
import { RailAside, RailRow, RailSection } from '../../components/SummaryRail'
import { useToast } from '../../components/Toast'
import { useTables, type TableName } from '../../lib/data'
import { fmtDate } from '../../lib/format'
import {
  GROUP_ORDER, enumFor, fieldsOf, groupFor, kindFor, labelFor, nameOf, prettify, referenceFor,
  submissionTitle,
} from '../../lib/approvalFields'
import {
  TABLE_LABELS, useAmendApproval, useDecideApproval, type ApprovalRequest,
} from '../../lib/approvals'
import NestedValue from './NestedValue'
import {
  InstallmentEditor, installmentTotal, type InstallmentRow,
} from '../../components/InstallmentEditor'

/**
 * One parked submission, in full, and editable.
 *
 * The queue used to show a one-line summary - "New sale - 20,000 L @ P42/L" -
 * and two buttons. Everything else the submitter typed was in the payload the
 * API already sent and simply not rendered, so approving was a decision taken
 * with four fields visible out of fifteen.
 *
 * Rendering all fifteen at once turned out to be its own problem: a wall of
 * inputs with Approve sitting under it, which invites deciding before reading.
 * So the fields are grouped into sections with a nav down the left, the same
 * frame as the seat, customer and employee editors, and the right-hand rail
 * keeps the whole submission in view: who sent it, the figures, and what - if
 * anything - the approver has changed, with the old value beside the new.
 * A stepped wizard was tried first; it hid the rest of the submission behind
 * Next, and the review at the end was a second reading of pages just read.
 */

/**
 * Installment statuses, per table. Same lists the module forms use - a sale is
 * collected, a purchase is paid.
 */
const INSTALLMENT_STATUSES: Record<string, { value: string; label: string }[]> = {
  sales: [
    { value: 'pending', label: 'Pending' },
    { value: 'collected', label: 'Collected' },
    { value: 'deposited', label: 'In clearing' },
    { value: 'cleared', label: 'Cleared' },
    { value: 'bounced', label: 'Bounced' },
    { value: 'cancelled', label: 'Cancelled' },
  ],
  purchases: [
    { value: 'pending', label: 'Pending' },
    { value: 'paid', label: 'Paid' },
    { value: 'cancelled', label: 'Cancelled' },
  ],
}

/** The reference tables the drawer resolves ids against. Fetched as a set
 * because a payload can point at several at once and useTables wants one call. */
const LOOKUPS = [
  'warehouses', 'suppliers', 'customers', 'personnel', 'agents', 'trucks', 'products', 'bankAccounts',
] as const satisfies readonly TableName[]

export default function ApprovalDrawer({ row, onClose, canDecide }: {
  row: ApprovalRequest
  onClose: () => void
  canDecide: boolean
}) {
  const tables = useTables(LOOKUPS)
  const decide = useDecideApproval()
  const amend = useAmendApproval()
  const toast = useToast()

  /** Only what the approver actually touched, so a save sends a real diff and
   * an untouched drawer sends nothing at all. */
  const [edits, setEdits] = useState<Record<string, unknown>>({})
  const [note, setNote] = useState('')

  const merged = useMemo(() => ({ ...row.payload, ...edits }), [row.payload, edits])
  const changed = Object.keys(edits).filter((k) => JSON.stringify(edits[k]) !== JSON.stringify(row.payload[k]))
  const dirty = changed.length > 0

  // The lookup tables have real types; this drawer only ever reads `id` and
  // whichever name field each one happens to carry, so it takes them as bags.
  const optionsFor = (tbl: TableName) =>
    ((tables?.[tbl as keyof typeof tables] ?? []) as unknown as Record<string, unknown>[])

  const set = (key: string, value: unknown) => setEdits((e) => ({ ...e, [key]: value }))

  /** How a value reads on the Review page - the same resolution the editable
   * control does, so the two pages cannot disagree about what is in the field.
   * Takes the value rather than reading `merged`, because the "was" half of a
   * change has to go through exactly the same resolution: showing the new depot
   * by name and the old one as `wh-cavite` tells the approver nothing. */
  function displayOf(key: string, value: unknown): string {
    if (value === null || value === undefined || value === '') return '—'
    const ref = referenceFor(key)
    if (ref) {
      const found = optionsFor(ref).find((o) => String(o.id) === String(value))
      return nameOf(found, value)
    }
    if (typeof value === 'boolean') return value ? 'Yes' : 'No'
    if (typeof value === 'number') return value.toLocaleString()
    const text = String(value)
    if (/^\d{4}-\d{2}-\d{2}/.test(text)) return fmtDate(text)
    return text.includes('_') ? prettify(text) : text
  }

  const display = (key: string) => displayOf(key, merged[key])

  async function save() {
    const patch = Object.fromEntries(changed.map((k) => [k, merged[k]]))
    try {
      await amend.mutateAsync({ id: row.id, payload: patch, tbl: row.tbl })
      toast(`Saved. ${changed.map(labelFor).join(', ')} changed on ${row.requestedByName}’s input.`)
      setEdits({})
      return true
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Unable to save these changes.')
      return false
    }
  }

  async function decideNow(decision: 'approve' | 'reject') {
    // Saving first, so an approver who edits and then hits Approve gets what
    // they see rather than what was parked. Two clicks would be a trap.
    if (dirty && decision === 'approve' && !(await save())) return
    await decide.mutateAsync({ id: row.id, decision, note, tbl: row.tbl })
    toast(decision === 'approve' ? 'Approved and posted.' : 'Rejected.')
    onClose()
  }

  /** One editable control, or the read-only rendering for a nested value. */
  function control(key: string) {
    const value = merged[key]
    const kind = kindFor(key, row.payload[key])
    const ref = referenceFor(key)
    const options = enumFor(row.tbl, key)
    const edited = changed.includes(key)

    if (kind === 'complex') {
      // Installments are the one nested value with a real editor already built
      // for them - the Sale and Purchase forms both use it. Rendering them
      // read-only here meant an approver who spotted a wrong due date had to
      // reject the whole submission over it.
      const statuses = INSTALLMENT_STATUSES[row.tbl]
      if (key === 'installments' && statuses && Array.isArray(value)) {
        const volume = Number(merged.volumeLiters ?? 0)
        const price = Number(merged.pricePerLiter ?? 0)
        return (
          <Field key={key} label={labelFor(key)} span2>
            <InstallmentEditor
              rows={value as InstallmentRow[]}
              // `amount` is derived and stored, so it has to be recomputed on
              // the way out or the schedule and its totals disagree - the same
              // mapping both module forms do on save.
              onChange={(rows) => set(key, rows.map((r) => ({
                ...r,
                amount: installmentTotal(r.principal, r.interestPct),
              })))}
              statusOptions={statuses}
              totalPrice={Math.round(volume * price * 100) / 100}
              collectorOptions={row.tbl === 'sales'
                ? optionsFor('personnel').map((o) => ({ value: String(o.id), label: nameOf(o, o.id) }))
                : undefined}
              bankOptions={row.tbl === 'sales'
                ? optionsFor('bankAccounts').map((o) => ({ value: String(o.id), label: nameOf(o, o.id) }))
                : undefined}
            />
          </Field>
        )
      }
      return (
        <Field key={key} label={labelFor(key)} span2>
          <NestedValue value={value} />
        </Field>
      )
    }

    return (
      <Field key={key} label={labelFor(key)} hint={edited ? 'Changed' : undefined}>
        {ref ? (
          <Select value={String(value ?? '')} onChange={(e) => set(key, e.target.value || null)}>
            <option value="">—</option>
            {optionsFor(ref).map((o) => (
              <option key={String(o.id)} value={String(o.id)}>{nameOf(o, o.id)}</option>
            ))}
          </Select>
        ) : options ? (
          <Select value={String(value ?? '')} onChange={(e) => set(key, e.target.value)}>
            {!options.includes(String(value ?? '')) && <option value={String(value ?? '')}>{display(key)}</option>}
            {options.map((o) => <option key={o} value={o}>{prettify(o)}</option>)}
          </Select>
        ) : kind === 'boolean' ? (
          <Select value={value ? 'yes' : 'no'} onChange={(e) => set(key, e.target.value === 'yes')}>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </Select>
        ) : (
          <Input
            type={kind === 'number' ? 'number' : kind === 'date' ? 'date' : 'text'}
            value={kind === 'date' ? String(value ?? '').slice(0, 10) : String(value ?? '')}
            onChange={(e) => set(key, kind === 'number' ? Number(e.target.value) : e.target.value)}
          />
        )}
      </Field>
    )
  }

  const keys = fieldsOf(row.payload)
  const groups = GROUP_ORDER
    .map((group) => ({ group, id: `ap-${group.toLowerCase()}`, fields: keys.filter((k) => groupFor(k) === group) }))
    .filter((g) => g.fields.length > 0)
  const sectionIds = [...groups.map((g) => g.id), ...(canDecide ? ['ap-decision'] : [])]
  const { active, jump } = useSectionNav(sectionIds)

  // A tick marks a section the approver has amended; a dot is as submitted.
  const navSections: FormNavSection[] = [
    ...groups.map((g) => ({
      id: g.id, title: g.group,
      state: g.fields.some((k) => changed.includes(k)) ? 'done' as const : 'todo' as const,
    })),
    ...(canDecide ? [{ id: 'ap-decision', title: 'Decision', state: note.trim() ? 'done' as const : 'todo' as const }] : []),
  ]

  const simpleKeys = keys.filter((k) => kindFor(k, row.payload[k]) !== 'complex')

  // The figures the server put in the summary, without the "New sale -" it
  // prefixes them with; the heading says that part now.
  const figures = row.summary?.split(' - ').slice(1).join(' - ') || TABLE_LABELS[row.tbl] || row.tbl

  return (
    <Dialog
      open
      title={submissionTitle(row.action, row.tbl)}
      subtitle={figures}
      onClose={onClose}
      width={WIDE_DIALOG}
      nav={<FormNav sections={navSections} active={active} onJump={jump} />}
      rail={
        <>
          {/* Who sent it, and when - true of every section, so it lives beside
              them rather than on one of them. */}
          <RailSection title="Submitted by">
            <span className="flex items-center gap-[8px]">
              <Avatar name={row.requestedByName} size={24} />
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-semibold leading-[1.2]">{row.requestedByName}</span>
                <span className="block font-meta text-[12px] leading-[1.3] text-mut">{fmtDate(row.requestedAt)}</span>
              </span>
            </span>
          </RailSection>

          {/* The submission as one column of facts, so the approver reads the
              whole of it without scrolling the form - and a changed field shows
              the old value beside the new. */}
          <RailSection title="Submission">
            {simpleKeys.map((k) => (
              <RailRow
                key={k}
                label={labelFor(k)}
                value={
                  <span className={changed.includes(k) ? 'font-semibold text-ink' : undefined}>
                    {display(k)}
                    {changed.includes(k) && (
                      <span className="ml-[6px] font-meta text-[11px] font-normal text-mut line-through">
                        {displayOf(k, row.payload[k])}
                      </span>
                    )}
                  </span>
                }
              />
            ))}
            {dirty
              ? <RailAside>Modifying {changed.map(labelFor).join(', ')}. {row.requestedByName} is notified when it posts.</RailAside>
              : <RailAside>Unchanged from the original submission.</RailAside>}
          </RailSection>
        </>
      }
      footer={
        canDecide ? (
          // Least to most committing, left to right - the primary sits at the
          // corner the eye ends on.
          <>
            {dirty && <GhostButton onClick={save}>Save changes only</GhostButton>}
            <GhostButton onClick={() => decideNow('reject')}>Reject</GhostButton>
            <PrimaryButton onClick={() => decideNow('approve')} disabled={decide.isPending || amend.isPending}>
              <span className="flex items-center gap-[6px]"><Check size={13} />{dirty ? 'Save and approve' : 'Approve'}</span>
            </PrimaryButton>
          </>
        ) : (
          <GhostButton onClick={onClose}>Close</GhostButton>
        )
      }
    >
      {groups.map((g, i) => (
        <div key={g.id}>
          <FormSection id={g.id} first={i === 0}>{g.group}</FormSection>
          <div className="grid grid-cols-2 gap-[14px]">{g.fields.map(control)}</div>
        </div>
      ))}

      {canDecide && (
        <div>
          <FormSection id="ap-decision">Decision</FormSection>
          <Field label="Note" hint="Optional. Sent to the submitter with the decision.">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason, or what was changed and why" />
          </Field>
        </div>
      )}
    </Dialog>
  )
}
