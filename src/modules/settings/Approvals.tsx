import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { InlineNotice } from '../../components/Notice'
import { Check, History, Settings as SettingsIcon, X } from 'lucide-react'
import ApprovalDrawer from './ApprovalDrawer'
import { Card, DataTable, Dialog, Field, GhostButton, InfoTip, Input, MiniDark, PageHeader, PrimaryButton, RowAction, TabBar, td } from '../../components/ui'
import { fmtDate } from '../../lib/format'
import { departmentFor, submissionTitle } from '../../lib/approvalFields'
import { useAuth } from '../../lib/auth'
import {
  TABLE_LABELS, useApprovalRules, useApprovals, useDecideApproval, useReverseApproval, useSaveApprovalRules,
  useWithdrawApproval, type ApprovalRequest, type ApprovalStatus,
} from '../../lib/approvals'
import { useToast } from '../../components/Toast'

/**
 * Pending inputs queue - Secondary Feature 2.1.
 *
 * "Staff-entered records ... enter a pending state and require an
 * administrator's approval before being confirmed and posted to the System."
 *
 * Nothing in this queue has been posted. Approving applies the parked write;
 * rejecting discards it. Either way the person who submitted it gets a
 * notification (2.11).
 */
export default function Approvals() {
  const { seat } = useAuth()
  const navigate = useNavigate()
  const mayApprove = Boolean(seat?.isAdmin || seat?.canApprove)
  const [tab, setTab] = useState<ApprovalStatus>('pending')
  const { data, isLoading } = useApprovals(tab, !mayApprove)

  const rows = data?.rows ?? []

  return (
    <div className="p-6">
      <PageHeader
        title={
          <span className="inline-flex items-center gap-[6px]">
            Approvals
            <InfoTip label="What a parked input means">
              {mayApprove
                ? 'Nothing here counts towards stock, sales or receivables until it is approved.'
                : 'Inputs you have sent for approval. They post to the System once an administrator approves them.'}
            </InfoTip>
          </span>
        }
        right={
          <div className="flex items-center gap-[8px]">
            {/* The app's one tab switch - the same segmented control as the
                Trips views - at the same 28px as the buttons beside it. */}
            <TabBar tabs={['pending', 'approved', 'rejected'] as const} active={tab} onChange={setTab} />
            {seat?.isAdmin && <RulesButton />}
            <MiniDark onClick={() => navigate('/settings/history')} title="Every approval, rejection, undo and edit, by who and when">
              <span className="flex items-center gap-[6px]"><History size={13} strokeWidth={2} />History</span>
            </MiniDark>
          </div>
        }
      />

      <Card className="mt-3">
        {isLoading ? (
          <p className="p-6 text-[13px] text-faint">Loading…</p>
        ) : (
          <DataTable
            cols={[
              { label: 'Date' },
              { label: 'Department' },
              // Not 'Sale': the queue carries purchases, trips and customer
              // records too, and the column holds what the submission is called
              // rather than what kind of thing it is - Department says that.
              { label: 'Title' },
              { label: 'Details' },
              { label: 'Staff' },
              { label: '', align: 'right' },
            ]}
            empty={
              tab === 'pending'
                ? 'Nothing is waiting for approval.'
                : `No ${tab} inputs yet.`
            }
          >
            {rows.map((r) => (
              <Row key={r.id} row={r} mayApprove={mayApprove} mine={r.requestedBy === seat?.id} tab={tab} />
            ))}
          </DataTable>
        )}
      </Card>
    </div>
  )
}

/**
 * Which record types need approval - the Q9 answer, made configurable rather
 * than hard-coded.
 *
 * Exhibit A names purchase orders and client sales "for example", so the list
 * was always going to grow. Keeping it in a settings record means adding
 * "Trips" or "Customer accounts" later is a tick-box here, not a redeploy.
 */
function RulesButton() {
  const { data, isLoading } = useApprovalRules()
  const save = useSaveApprovalRules()
  const [open, setOpen] = useState(false)

  if (isLoading || !data) return null
  const selected = new Set(data.rules.tables)

  function toggle(tbl: string) {
    const next = new Set(selected)
    if (next.has(tbl)) next.delete(tbl)
    else next.add(tbl)
    save.mutate({ tables: [...next], minAmount: data?.rules.minAmount ?? 0 })
  }

  const summary = data.rules.tables.length
    ? data.rules.tables.map((t) => TABLE_LABELS[t] ?? t).join(', ')
    : 'Nothing - every input posts straight to the System.'

  return (
    <>
      {/* This was a full-width bar above the queue, permanently restating a
          setting that changes about once. The queue is what the page is for;
          the rule behind it is a setting, so it gets a settings control and
          stays out of the way until someone wants it. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="What needs approval"
        aria-label="What needs approval"
        className="flex h-[28px] w-[28px] shrink-0 cursor-pointer items-center justify-center rounded-[6px] border border-inputline bg-white text-lab transition-colors hover:bg-fill2"
      >
        <SettingsIcon size={14} strokeWidth={1.8} />
      </button>

      <Dialog
        open={open}
        title="What needs approval"
        subtitle={summary}
        onClose={() => setOpen(false)}
        width={520}
        footer={<GhostButton onClick={() => setOpen(false)}>Done</GhostButton>}
      >
        <div className="grid grid-cols-2 gap-2">
          {data.approvable.map((tbl) => (
            <label key={tbl} className="flex cursor-pointer items-center gap-2 rounded-[8px] px-2 py-[6px] text-[13px] hover:bg-fill2">
              <input
                type="checkbox"
                checked={selected.has(tbl)}
                onChange={() => toggle(tbl)}
                className="cursor-pointer accent-teal"
              />
              <span className="text-lab">{TABLE_LABELS[tbl] ?? tbl}</span>
            </label>
          ))}
        </div>
        {/* Each tick saves on its own, so there is nothing to submit - but that
            is invisible unless it is said. */}
        <p className="m-0 mt-3 font-meta text-[12px] text-faint">
          Saved as you tick. Records already waiting are unaffected.
        </p>
      </Dialog>
    </>
  )
}

function Row({ row, mayApprove, mine, tab }: {
  row: ApprovalRequest
  mayApprove: boolean
  mine: boolean
  tab: ApprovalStatus
}) {
  const decide = useDecideApproval()
  const withdraw = useWithdrawApproval()
  const reverse = useReverseApproval()
  const toast = useToast()
  const { seat } = useAuth()
  const [open, setOpen] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [undoing, setUndoing] = useState(false)
  const [note, setNote] = useState('')
  // A decision can be taken back by an admin, or by the approver who made it.
  const canUndo = tab !== 'pending' && mayApprove && (seat?.isAdmin || row.decidedBy === seat?.id)

  // A seat that may approve still cannot wave through its own input unless it is
  // an admin - that is the entire point of the feature.
  const canDecideThis = mayApprove && tab === 'pending'

  // The figures, without the "New sale -" the server prefixes them with; the
  // Sale column says that part.
  const details = row.summary?.split(' - ').slice(1).join(' - ') || '—'

  return (
    <>
    {/* The row itself opens the full submission, as a purchase or a history
        entry does - the columns name four fields out of fifteen, and deciding
        honestly means reading the rest. Notes on a decision are taken in
        there too. */}
    <tr
      role="button"
      tabIndex={0}
      aria-label={`Review ${submissionTitle(row.action, row.tbl)} from ${row.requestedByName}`}
      onClick={() => setOpen(true)}
      onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) setOpen(true) }}
      className="cursor-pointer transition-colors hover:bg-paper focus:outline-none focus-visible:bg-paper"
    >
      <td className={`${td} whitespace-nowrap text-mut`}>{fmtDate(row.requestedAt)}</td>

      <td className={`${td} whitespace-nowrap text-mut`}>{departmentFor(row.tbl)}</td>

      <td className={`${td} whitespace-nowrap font-semibold text-lab`}>
        {submissionTitle(row.action, row.tbl)}
      </td>

      <td className={td}>
        {details}
        {row.decisionNote && <span className="block text-[12px] text-faint">“{row.decisionNote}”</span>}
        {tab !== 'pending' && row.decidedByName && (
          <span className="block font-meta text-[12px] text-faint">
            {tab === 'approved' ? 'Approved' : 'Rejected'} by {row.decidedByName}
            {row.decidedAt ? ` · ${fmtDate(row.decidedAt)}` : ''}
          </span>
        )}
      </td>

      <td className={`${td} whitespace-nowrap text-mut`}>{row.requestedByName}</td>

      <td className={`${td} text-right`} onClick={(e) => e.stopPropagation()}>
        {canDecideThis ? (
          /* The same shape as every other list: the thing to do as a small
             dark text button, the housekeeping as plain icons. */
          <span className="flex items-center justify-end gap-[4px]">
            <MiniDark onClick={() => decide.mutate({ id: row.id, decision: 'approve', tbl: row.tbl })}>Approve</MiniDark>
            <RowAction verb="cancel" icon={X} label="Reject" onClick={() => setRejecting(true)} />
          </span>
        ) : tab !== 'pending' ? (
          <span className="flex items-center justify-end gap-[6px]">
            <span
              title={tab === 'approved' ? 'Approved' : 'Rejected'}
              className={`inline-flex h-[26px] w-[26px] items-center justify-center ${tab === 'approved' ? 'text-sec' : 'text-redtext'}`}
            >
              {tab === 'approved' ? <Check size={14} strokeWidth={2} /> : <X size={14} strokeWidth={2} />}
            </span>
            {/* Decided by mistake? Back to the queue - and, for an approval,
                the posted record is unwound. The server refuses if someone has
                worked on it since, and says who. */}
            {canUndo && (
              <RowAction verb="revert" label={`Undo ${tab === 'approved' ? 'approval' : 'rejection'}`} onClick={() => setUndoing(true)} />
            )}
            <Dialog
              open={undoing}
              title={tab === 'approved' ? 'Undo this approval' : 'Undo this rejection'}
              subtitle={`${submissionTitle(row.action, row.tbl)} · ${row.requestedByName}`}
              onClose={() => { setUndoing(false); setNote('') }}
              width={480}
              footer={
                <>
                  <GhostButton onClick={() => { setUndoing(false); setNote('') }}>Cancel</GhostButton>
                  <PrimaryButton
                    disabled={reverse.isPending}
                    onClick={() => {
                      reverse.mutate({ id: row.id, note, tbl: row.tbl }, {
                        onSuccess: () => { toast('Back in the queue.'); setUndoing(false); setNote('') },
                        onError: (e) => toast(e instanceof Error ? e.message : 'Couldn’t undo this decision.'),
                      })
                    }}
                  >
                    Undo
                  </PrimaryButton>
                </>
              }
            >
              <p className="m-0 mb-3 text-[13px] text-sec">
                {tab === 'approved'
                  ? `The ${row.action === 'create' ? 'record this posted is removed' : row.action === 'delete' ? 'deleted record is put back' : 'edit this posted is reversed'}, and the input goes back to Pending for a fresh decision. If anyone has changed the record since, the undo is refused and you will be told who.`
                  : 'The input goes back to Pending for a fresh decision. Nothing was posted, so nothing else changes.'}
              </p>
              <Field label="Reason" hint="Optional. Goes to the submitter and into the history.">
                <Input value={note} placeholder="Approved the wrong line…" onChange={(e) => setNote(e.target.value)} />
              </Field>
            </Dialog>
          </span>
        ) : mine ? (
          <GhostButton onClick={() => withdraw.mutate(row.id)}>Withdraw</GhostButton>
        ) : (
          <span className="text-[12px] text-faint">Waiting</span>
        )}
      </td>
    </tr>
    {open && (
      <ApprovalDrawer row={row} canDecide={canDecideThis} onClose={() => setOpen(false)} />
    )}
    {/* Approving needs no explanation; rejecting does. The row's ✕ asks for
        one rather than discarding someone's work on a single click - and
        the reason reaches the submitter with the decision, which is the
        difference between "not approved" and something they can act on. */}
        <Dialog
          open={rejecting}
          title="Reject this input"
          subtitle={`${submissionTitle(row.action, row.tbl)} · ${row.requestedByName}`}
          onClose={() => { setRejecting(false); setNote('') }}
          width={480}
          footer={
            <>
              <GhostButton onClick={() => { setRejecting(false); setNote('') }}>Cancel</GhostButton>
              <PrimaryButton
                onClick={() => {
                  decide.mutate({ id: row.id, decision: 'reject', note, tbl: row.tbl })
                  setRejecting(false)
                  setNote('')
                }}
              >
                Reject
              </PrimaryButton>
            </>
          }
        >
          <Field label="Reason" hint="Optional. This is the only explanation the submitter receives.">
            <Input
              value={note}
              placeholder="Incorrect depot, price does not match the quote…"
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
        </Dialog>
    </>
  )
}

/** Small banner for a module screen, so staff see their own parked inputs where
 * they work rather than only in this queue. */
export function PendingBanner({ tbl }: { tbl: string }) {
  const navigate = useNavigate()
  const { data } = useApprovals('pending', true)
  const mine = (data?.rows ?? []).filter((r) => r.tbl === tbl)
  if (!mine.length) return null
  return (
    // One line, in the app's own colours. This was a two-line amber card at the
    // top of seven screens, drawn in raw Tailwind ambers that appear nowhere
    // else in the System - a band of the page, every visit, to report a number.
    // Nothing here is wrong, so nothing here is red: an input waiting for an
    // approver is the feature working.
    <InlineNotice className="mb-3" action="Open" onAction={() => navigate('/settings/approvals')}>
      {mine.length} {mine.length === 1 ? 'input is' : 'inputs are'} waiting for an administrator,
      and {mine.length === 1 ? 'is' : 'are'} not yet reflected in the figures
    </InlineNotice>
  )
}
